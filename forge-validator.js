#!/usr/bin/env node
/**
 * forge-validator.js
 * Validates SCP capsule hypotheses against real Kraken historical data.
 * Uses 80% of candles for backtest, 20% for forward validation.
 * Both must pass the gate for a strategy to be accepted.
 *
 * Pass criteria (backtest AND forward):
 *   Win rate >= 50%
 *   Return > 0%
 *   Minimum 5 trades
 *
 * Usage:
 *   node forge-validator.js
 *   node forge-validator.js --capsule path/to/capsule.json
 */

'use strict';
const cs = require('./chronoscribe');

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH     = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const SCP_PATH    = path.join(process.env.HOME, 'cce/engines/scp');
const FAILURE_LOG = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/validation_failures.json');

const MIN_WIN_RATE   = 50.0;
const MIN_RETURN     = 0.0;
const MIN_TRADES     = 10;
const WARMUP_CANDLES = 50;
const TRAIN_SPLIT    = 0.8;

const EXTERNAL_KEYWORDS = ['fear', 'greed', 'certiscope', 'certainty', 'sentiment', 'web', 'index', 'external'];
const KNOWN_KEYWORDS    = ['consecutive red', 'rsi', 'volatility', 'bollinger', 'volume', 'ma(', 'moving average'];

// ── Data ───────────────────────────────────────────────────────────────────────

async function loadCandles(symbol, interval, limit) {
  symbol   = symbol   || 'BTC/USD';
  interval = interval || '1D';
  limit    = limit    || 721;
  try {
    const SQL    = await initSqlJs();
    const db     = new SQL.Database(fs.readFileSync(DB_PATH));
    const result = db.exec(
      'SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC LIMIT ?',
      [symbol, interval, limit]
    );
    db.close();
    if (!result.length || !result[0].values.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
      const c = {};
      columns.forEach((col, i) => c[col] = typeof row[i] === 'bigint' ? Number(row[i]) : row[i]);
      return c;
    });
  } catch (e) {
    console.error('   Database error: ' + e.message);
    return [];
  }
}

// ── Indicators ─────────────────────────────────────────────────────────────────

function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

function calcMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcBollinger(closes, period) {
  period = period || 20;
  if (closes.length < period) return { upper: null, middle: null, lower: null };
  const w   = closes.slice(-period);
  const mid = w.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(w.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period);
  return { upper: mid + 2 * std, middle: mid, lower: mid - 2 * std };
}

function calcConsecRed(candles, idx) {
  let count = 0, i = idx;
  while (i >= 0 && candles[i].close < candles[i].open) { count++; i--; }
  return count;
}

function calcVolumeAvg(candles, idx, period) {
  period    = period || 20;
  const vols = candles.slice(Math.max(0, idx - period), idx).map(c => c.volume);
  if (!vols.length) return 0;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

// ── Rule evaluator ─────────────────────────────────────────────────────────────

const warnedRules = {};

function evaluateRule(rule, candles, idx) {
  const rl     = rule.toLowerCase().trim();
  const candle = candles[idx];
  const closes = candles.slice(0, idx + 1).map(c => c.close);

  if (rl.includes('consecutive red')) {
    const m = rl.match(/(\d+)\s+consecutive red/);
    return calcConsecRed(candles, idx) >= (m ? parseInt(m[1]) : 3);
  }
  if (rl.includes('rsi')) {
    const pm  = rl.match(/rsi\(?(\d+)\)?/);
    const rsi = calcRSI(closes, pm ? parseInt(pm[1]) : 14);
    if (rl.includes('<')) { const v = rl.match(/<\s*([\d.]+)/); return rsi < (v ? parseFloat(v[1]) : 30); }
    if (rl.includes('>')) { const v = rl.match(/>\s*([\d.]+)/); return rsi > (v ? parseFloat(v[1]) : 70); }
  }
  if (rl.includes('bollinger')) {
    const bb = calcBollinger(closes);
    if (bb.lower === null) return false;
    if (rl.includes('below lower')) return candle.close < bb.lower;
    if (rl.includes('above upper')) return candle.close > bb.upper;
  }
  if (rl.includes('volatility')) {
    const vol = candle.open > 0 ? (candle.high - candle.low) / candle.open * 100 : 0;
    if (rl.includes('<')) { const v = rl.match(/<\s*([\d.]+)/); return vol < (v ? parseFloat(v[1]) : 2.5); }
    if (rl.includes('>')) { const v = rl.match(/>\s*([\d.]+)/); return vol > (v ? parseFloat(v[1]) : 3.5); }
  }
  if (rl.includes('volume')) {
    const avg = calcVolumeAvg(candles, idx);
    if (avg === 0) return false;
    const m = rl.match(/([\d.]+)\s*x/);
    return candle.volume > avg * (m ? parseFloat(m[1]) : 1.5);
  }
  if (rl.includes('ma(') || rl.includes('moving average')) {
    const pm = rl.match(/ma\((\d+)\)/);
    const ma = calcMA(closes, pm ? parseInt(pm[1]) : 50);
    if (rl.includes('price above') || rl.includes('above ma')) return candle.close > ma;
    if (rl.includes('price below') || rl.includes('below ma')) return candle.close < ma;
  }
  if (!warnedRules[rl]) { console.log('   Unrecognised rule (skipped): ' + rule); warnedRules[rl] = true; }
  return false;
}

function evaluateRules(rules, candles, idx) {
  if (!rules || !rules.length) return false;
  return rules.every(rule => {
    const rl = rule.toLowerCase().trim();
    if (EXTERNAL_KEYWORDS.some(kw => rl.includes(kw))) return false;
    if (!KNOWN_KEYWORDS.some(kw => rl.includes(kw))) {
      if (!warnedRules[rl]) { console.log('   Unrecognised rule (skipped): ' + rule); warnedRules[rl] = true; }
      return false;
    }
    return evaluateRule(rule, candles, idx);
  });
}

function evaluatePhoneStrategy(type, params, candles, idx) {
  const closes = candles.slice(0, idx + 1).map(c => c.close);
  switch (type) {
    case 'consecutive_red': return calcConsecRed(candles, idx) >= (params.consecutiveRed || 3);
    case 'smart_btc':       return calcConsecRed(candles, idx) >= 4 || calcRSI(closes, 30) < 30;
    case 'mean_reversion':  return calcConsecRed(candles, idx) >= 3 && calcRSI(closes, 14) < 35;
    default: return false;
  }
}

// ── Simulate ───────────────────────────────────────────────────────────────────

function parsePct(value) {
  try { return parseFloat(String(value).replace('%', '').replace('+', '').trim()); } catch (e) { return 0; }
}

function simulate(capsule, candles) {
  const ctx        = capsule.semantic_context || {};
  const risk       = ctx.risk_management || capsule.strategy || {};
  const manifest   = capsule.manifest || {};
  const entryRules = ctx.entry_rules || [];
  const exitRules  = ctx.exit_rules  || [];
  const stopPct    = Math.abs(parsePct(risk.stop_loss   || risk.stopPct   || '-8%'))  / 100;
  const targetPct  =          parsePct(risk.take_profit || risk.targetPct || '+15%')  / 100;
  const maxHold    = parseInt(risk.max_hold_days        || risk.maxHoldDays || 10);
  const usePhone   = !entryRules.length && manifest.type;

  let capital = 1000, inPosition = false, entryPrice = 0, entryIdx = 0;
  const trades = [];

  for (let i = WARMUP_CANDLES; i < candles.length; i++) {
    const price = candles[i].close;
    if (!inPosition) {
      const triggered = usePhone
        ? evaluatePhoneStrategy(manifest.type, manifest.parameters || {}, candles, i)
        : evaluateRules(entryRules, candles, i);
      if (triggered) { inPosition = true; entryPrice = price; entryIdx = i; }
    } else {
      const hold   = i - entryIdx;
      const pnlPct = entryPrice > 0 ? (price - entryPrice) / entryPrice : 0;
      const hitTP  = pnlPct >= targetPct;
      const hitSL  = pnlPct <= -stopPct;
      const hitT   = hold >= maxHold;
      const hitE   = exitRules.length ? evaluateRules(exitRules, candles, i) : false;
      if (hitTP || hitSL || hitT || hitE) {
        capital *= (1 + pnlPct);
        trades.push({ pnl: Math.round(pnlPct * 10000) / 100, win: pnlPct > 0, hold_days: hold,
          reason: hitTP ? 'take_profit' : hitSL ? 'stop_loss' : hitT ? 'timeout' : 'exit_rule' });
        inPosition = false;
      }
    }
  }

  if (inPosition) {
    const price  = candles[candles.length - 1].close;
    const pnlPct = entryPrice > 0 ? (price - entryPrice) / entryPrice : 0;
    capital *= (1 + pnlPct);
    trades.push({ pnl: Math.round(pnlPct * 10000) / 100, win: pnlPct > 0, hold_days: candles.length - entryIdx, reason: 'closeout' });
  }

  const total = trades.length;
  const wins  = trades.filter(t => t.win).length;
  const wr    = total > 0 ? Math.round(wins / total * 1000) / 10 : 0;
  const ret   = Math.round((capital - 1000) / 1000 * 1000) / 10;
  return { total_trades: total, win_rate: wr + '%', backtest_return: (ret >= 0 ? '+' : '') + ret + '%', capital_final: Math.round(capital * 100) / 100, trade_log: trades.slice(-5) };
}

// ── Gate ───────────────────────────────────────────────────────────────────────

function passesGate(metrics) {
  const wr     = parsePct(metrics.win_rate);
  const ret    = parsePct(metrics.backtest_return);
  const trades = metrics.total_trades || 0;
  const fails  = [];
  if (trades < MIN_TRADES) fails.push('only ' + trades + ' trades (min ' + MIN_TRADES + ')');
  if (wr < MIN_WIN_RATE)   fails.push('WR ' + wr + '% (min ' + MIN_WIN_RATE + '%)');
  if (ret <= MIN_RETURN)   fails.push('return ' + ret + '% (must be > ' + MIN_RETURN + '%)');
  if (fails.length) return { passed: false, reason: 'Failed: ' + fails.join(', ') };
  return { passed: true, reason: 'Passed: ' + wr + '% WR, ' + (ret >= 0 ? '+' : '') + ret + '% return, ' + trades + ' trades' };
}

// ── Failure memory ─────────────────────────────────────────────────────────────

function saveFailure(id, name, metrics, reason, entryRules, exitRules) {
  let failures = [];
  try { if (fs.existsSync(FAILURE_LOG)) failures = JSON.parse(fs.readFileSync(FAILURE_LOG, 'utf8')); } catch (e) {}
  failures.unshift({ id, name, reason, win_rate: metrics.win_rate, return: metrics.backtest_return, trades: metrics.total_trades, entry_rules: entryRules, exit_rules: exitRules, failed_at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(FAILURE_LOG), { recursive: true });
  fs.writeFileSync(FAILURE_LOG, JSON.stringify(failures.slice(0, 10), null, 2));
}

// ── Strategy pool ──────────────────────────────────────────────────────────────

function addToStrategyPool(capsule, backtest, forward) {
  const selectorPath = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/strategy_selector.js');
  if (!fs.existsSync(selectorPath)) return;
  const manifest = capsule.manifest || {};
  const ctx      = capsule.semantic_context || {};
  const risk     = ctx.risk_management || capsule.strategy || {};
  const id       = manifest.id || 'generated_strategy';
  const cleanId  = id.replace(/[^a-z0-9_]/gi, '_').toLowerCase();

  const newStrategy = {
    name:             manifest.name || cleanId,
    entry:            (ctx.entry_rules || []).join(' AND ') || manifest.type || 'generated',
    target:           parsePct(risk.take_profit || risk.targetPct || 8),
    stop:             Math.abs(parsePct(risk.stop_loss || risk.stopPct || 2)),
    hold:             parseInt(risk.max_hold_days || risk.maxHoldDays || 10),
    bestRegimes:      [ctx.regime || (manifest.marketFit && manifest.marketFit.bestRegime) || 'RANGING'],
    bestSentiment:    ['NEUTRAL', 'FEAR'],
    minVolatility:    1.0,
    maxVolatility:    5.0,
    validated:        true,
    win_rate:         backtest.win_rate,
    backtest_return:  backtest.backtest_return,
    forward_win_rate: forward.win_rate,
    forward_return:   forward.backtest_return,
    validated_at:     new Date().toISOString()
  };

  let content = fs.readFileSync(selectorPath, 'utf8');
  if (content.includes("'" + cleanId + "'")) { console.log('   Strategy already in pool'); return; }

  const insertPoint = content.indexOf('    };\n  }');
  if (insertPoint === -1) { console.log('   Could not find insertion point'); return; }

  const entry = ',\n      \'' + cleanId + '\': ' + JSON.stringify(newStrategy, null, 6).replace(/^/gm, '      ').trim();
  content     = content.slice(0, insertPoint) + entry + '\n' + content.slice(insertPoint);
  fs.writeFileSync(selectorPath, content);
  console.log('   Added ' + cleanId + ' to strategy pool');
}

// ── Find capsules ──────────────────────────────────────────────────────────────

function findHypothesisCapsules(targetPath) {
  const capsules = [];
  if (!fs.existsSync(targetPath)) return capsules;
  for (const entry of fs.readdirSync(targetPath)) {
    const full = path.join(targetPath, entry);
    if (fs.statSync(full).isDirectory()) {
      const capsuleFile = path.join(full, 'capsule.json');
      if (fs.existsSync(capsuleFile)) {
        try {
          const data   = JSON.parse(fs.readFileSync(capsuleFile, 'utf8'));
          const status = (data.manifest && data.manifest.status) || (data.lifecycle && data.lifecycle.status) || '';
          if (status === 'generated' || status === 'hypothesis') capsules.push({ path: capsuleFile, data, id: entry });
        } catch (e) {}
      }
    }
  }
  return capsules;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function validate(specificCapsulePath) {
  console.log('FORGE VALIDATOR (80/20 Split)');
  console.log('='.repeat(50));
  console.log('   Gate:   WR >= ' + MIN_WIN_RATE + '% | Return > ' + MIN_RETURN + '% | Trades >= ' + MIN_TRADES);
  console.log('   Split:  80% backtest / 20% forward — both must pass');
  console.log('='.repeat(50));

  console.log('\n   Loading candle data...');
  const candles = await loadCandles('BTC/USD', '1D', 721);
  if (!candles.length) { console.log('   No candle data'); return; }

  const splitIdx   = Math.floor(candles.length * TRAIN_SPLIT);
  const trainData  = candles.slice(0, splitIdx);
  const forwardData = candles.slice(splitIdx);
  console.log('   Loaded ' + candles.length + ' candles (' + trainData.length + ' train / ' + forwardData.length + ' forward)\n');

  let toTest = [];
  if (specificCapsulePath) {
    try { const data = JSON.parse(fs.readFileSync(specificCapsulePath, 'utf8')); toTest.push({ path: specificCapsulePath, data, id: path.basename(specificCapsulePath) }); }
    catch (e) { console.log('   Could not load capsule: ' + e.message); return; }
  } else {
    toTest = findHypothesisCapsules(SCP_PATH);
  }

  if (!toTest.length) { console.log('   No hypothesis capsules found.\n   (Looking in: ' + SCP_PATH + ')'); return; }
  console.log('   Found ' + toTest.length + ' hypothesis capsule(s).\n');

  let passed = 0, failed = 0;

  for (const item of toTest) {
    const capsule = item.data;
    const name    = (capsule.manifest && capsule.manifest.name) || (capsule.asset && capsule.asset.name) || item.id;
    console.log('Testing: ' + name);

    const backtest = simulate(capsule, trainData);
    const forward  = simulate(capsule, forwardData);

    console.log('   Backtest  (' + trainData.length + ' candles): ' + backtest.total_trades + ' trades | WR: ' + backtest.win_rate + ' | Return: ' + backtest.backtest_return);
    console.log('   Forward   (' + forwardData.length + ' candles): ' + forward.total_trades + ' trades | WR: ' + forward.win_rate + ' | Return: ' + forward.backtest_return);

    const btResult  = passesGate(backtest);
    const fwdResult = passesGate(forward);
    const didPass   = btResult.passed && fwdResult.passed;
    const reason    = didPass
      ? 'BT: ' + btResult.reason + ' | FWD: ' + fwdResult.reason
      : (!btResult.passed ? 'Backtest: ' + btResult.reason : 'Forward: ' + fwdResult.reason);
    const icon      = didPass ? 'PASSED' : 'FAILED';

    console.log('   ' + icon + ' — ' + reason);

    const newStatus = didPass ? 'dry_run' : 'failed_validation';
    if (capsule.manifest)       { capsule.manifest.status = newStatus; capsule.manifest.validation = { passed: didPass, reason, validated_at: new Date().toISOString() }; }
    if (capsule.lifecycle)      { capsule.lifecycle.status = newStatus; capsule.lifecycle.last_updated = new Date().toISOString(); capsule.lifecycle.validation = { passed: didPass, reason, backtest, forward }; }
    if (capsule.semantic_context) capsule.semantic_context.performance_metrics = { backtest, forward };

    fs.writeFileSync(item.path, JSON.stringify(capsule, null, 2));
    console.log('   Saved as ' + newStatus + '.');

    if (didPass) {
      passed++;
      addToStrategyPool(capsule, backtest, forward);
      cs.recordStrategyValidation(name, 'passed', parseFloat(backtest.win_rate), parseFloat(backtest.backtest_return), backtest.total_trades, (capsule.semantic_context && capsule.semantic_context.regime) || 'UNKNOWN', reason);
      cs.recordCapsulePromotion(item.id, name, 'hypothesis', parseFloat(backtest.win_rate) * 0.6 + Math.max(0, parseFloat(backtest.backtest_return)) * 0.4, parseFloat(backtest.win_rate), parseFloat(backtest.backtest_return));
    } else {
      failed++;
      const entryRules = (capsule.semantic_context && capsule.semantic_context.entry_rules) || [];
      const exitRules  = (capsule.semantic_context && capsule.semantic_context.exit_rules)  || [];
      saveFailure(item.id, name, backtest, reason, entryRules, exitRules);
      cs.recordStrategyValidation(name, 'failed', parseFloat(backtest.win_rate), parseFloat(backtest.backtest_return), backtest.total_trades, 'UNKNOWN', reason);
      console.log('   Failure recorded.');
    }
    console.log();
  }

  console.log('='.repeat(50));
  console.log('   Complete: ' + passed + ' passed, ' + failed + ' failed.');
  if (passed > 0) console.log('   ' + passed + ' strategy/strategies added to pool with forward validation.');
  console.log('='.repeat(50));
}

const args         = process.argv.slice(2);
const capsuleFlag  = args.indexOf('--capsule');
const specificPath = capsuleFlag !== -1 ? args[capsuleFlag + 1] : null;
validate(specificPath).catch(console.error);

// Add to top of file after requires
const ARCHIVE_FILE = path.join(__dirname, 'strategy_archive.json');

// Add this function to load archive
function loadArchive() {
  if (!fs.existsSync(ARCHIVE_FILE)) {
    return { archived_strategies: [], summary: { total_archived: 0 } };
  }
  return JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
}

// Add this function to save to archive
function archiveStrategy(strategy, result, reason) {
  const archive = loadArchive();
  
  const archivedEntry = {
    id: strategy.manifest?.id || `archived_${Date.now()}`,
    name: strategy.manifest?.name || strategy.name || "Unknown Strategy",
    archived_at: new Date().toISOString(),
    reason: reason,
    metrics: {
      win_rate: result.backtest?.win_rate || result.win_rate,
      return: result.backtest?.return || result.return,
      trades: result.backtest?.trades || result.trades,
      score: result.score,
      grade: result.grade
    },
    regime: strategy.manifest?.marketFit?.bestRegime || "UNKNOWN",
    parameters: strategy.manifest?.parameters || {},
    entry_rules: strategy.strategy?.entryRules || {},
    exit_rules: strategy.strategy?.exitRules || {}
  };
  
  archive.archived_strategies.unshift(archivedEntry); // newest first
  archive.last_updated = new Date().toISOString();
  archive.summary.total_archived = archive.archived_strategies.length;
  
  // Update summary averages
  const validArchives = archive.archived_strategies.filter(s => s.metrics.win_rate);
  if (validArchives.length > 0) {
    const totalWR = validArchives.reduce((sum, s) => sum + (s.metrics.win_rate || 0), 0);
    const totalReturn = validArchives.reduce((sum, s) => sum + (s.metrics.return || 0), 0);
    archive.summary.average_win_rate = totalWR / validArchives.length;
    archive.summary.average_return = totalReturn / validArchives.length;
  }
  
  // Update regime counts
  archive.summary.by_regime = {
    RANGING: archive.archived_strategies.filter(s => s.regime === "RANGING").length,
    TRENDING_UP: archive.archived_strategies.filter(s => s.regime === "TRENDING_UP").length,
    TRENDING_DOWN: archive.archived_strategies.filter(s => s.regime === "TRENDING_DOWN").length,
    VOLATILE: archive.archived_strategies.filter(s => s.regime === "VOLATILE").length
  };
  
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
  console.log(`📦 Archived: ${archivedEntry.name} (${reason})`);
  
  return archive;
}

// Add function to get best strategy for a regime
function getBestArchivedStrategy(regime) {
  const archive = loadArchive();
  const regimeStrategies = archive.archived_strategies.filter(s => s.regime === regime);
  if (regimeStrategies.length === 0) return null;
  
  // Sort by score descending
  regimeStrategies.sort((a, b) => (b.metrics.score || 0) - (a.metrics.score || 0));
  return regimeStrategies[0];
}

// Add function to list archive
function listArchive(limit = 10) {
  const archive = loadArchive();
  console.log(`\n📦 STRATEGY ARCHIVE (${archive.summary.total_archived} total)`);
  console.log("═".repeat(70));
  console.log(`  Avg WR: ${archive.summary.average_win_rate?.toFixed(1) || 0}% | Avg Return: ${archive.summary.average_return?.toFixed(1) || 0}%`);
  console.log(`  By regime: R:${archive.summary.by_regime.RANGING} | U:${archive.summary.by_regime.TRENDING_UP} | D:${archive.summary.by_regime.TRENDING_DOWN} | V:${archive.summary.by_regime.VOLATILE}`);
  console.log("─".repeat(70));
  
  const recent = archive.archived_strategies.slice(0, limit);
  for (const s of recent) {
    console.log(`  ${s.archived_at.split('T')[0]} | ${s.name.substring(0, 30)} | WR:${s.metrics.win_rate?.toFixed(1) || 0}% | Score:${s.metrics.score?.toFixed(0) || 0} | ${s.reason}`);
  }
  return archive;
}
