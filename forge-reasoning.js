#!/usr/bin/env node
/**
 * forge-reasoning.js
 * Generates hypothesis capsules based on:
 *   - Current market state
 *   - Performance history of validated strategies
 *   - Failure memory
 *
 * Usage:
 *   node forge-reasoning.js
 *   node forge-reasoning.js --dry-run
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const MarketAnalyser = require('./reasoning-bot/market_analyser');

const SCP_PATH      = path.join(process.env.HOME, 'cce/engines/scp');
const FAILURE_LOG   = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/validation_failures.json');
const SELECTOR_PATH = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/strategy_selector.js');
const USED_FILE     = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/used_templates.json');

// ── Templates ──────────────────────────────────────────────────────────────────

const TEMPLATES = {
  consecutive_red_rsi: (p) => ({
    name:        'H.E Consecutive Red + RSI',
    regime:      p.regime,
    entry_rules: [p.redDays + ' consecutive red days', 'RSI(14) < ' + p.rsiEntry],
    exit_rules:  ['RSI(14) > ' + p.rsiExit],
    risk:        { stop: p.stop, target: p.target, hold: p.hold }
  }),
  mean_reversion_bollinger: (p) => ({
    name:        'H.E Mean Reversion Bollinger',
    regime:      p.regime,
    entry_rules: ['Price below lower Bollinger Band', 'RSI(14) < ' + p.rsiEntry],
    exit_rules:  ['RSI(14) > 50', 'Price above MA(20)'],
    risk:        { stop: p.stop, target: p.target, hold: p.hold }
  }),
  oversold_bounce: (p) => ({
    name:        'H.E Oversold Bounce',
    regime:      p.regime,
    entry_rules: ['RSI(14) < ' + p.rsiEntry, 'Price below lower Bollinger Band'],
    exit_rules:  ['RSI(14) > ' + p.rsiExit, 'Price above MA(50)'],
    risk:        { stop: p.stop, target: p.target, hold: p.hold }
  }),
  volatility_breakout: (p) => ({
    name:        'H.E Volatility Breakout',
    regime:      p.regime,
    entry_rules: ['Market Volatility > ' + p.volEntry + '%', 'Volume > 1.5x average'],
    exit_rules:  ['RSI(14) > 60'],
    risk:        { stop: p.stop, target: p.target, hold: p.hold }
  }),
  trend_continuation: (p) => ({
    name:        'H.E Trend Continuation',
    regime:      p.regime,
    entry_rules: ['MA(20) above MA(50)', 'RSI(14) > 45'],
    exit_rules:  ['RSI(14) > 70'],
    risk:        { stop: p.stop, target: p.target, hold: p.hold }
  })
};

// ── Performance history ────────────────────────────────────────────────────────

function loadPerformanceHistory() {
  try {
    const content = fs.readFileSync(SELECTOR_PATH, 'utf8');
    const history = [];
    const lines   = content.split('\n');

    let inHyp   = false;
    let current = {};

    for (const line of lines) {
      if (line.includes("'hyp_") && line.includes(':') && line.includes('{')) {
        inHyp   = true;
        current = {};
      }
      if (!inHyp) continue;

      const wr  = line.match(/"win_rate":\s*"([\d.]+)%"/);
      const ret = line.match(/"backtest_return":\s*"([+-]?[\d.]+)%"/);
      const tgt = line.match(/"target":\s*([\d.]+)/);
      const stp = line.match(/"stop":\s*([\d.]+)/);
      const hld = line.match(/"hold":\s*([\d.]+)/);

      if (wr)  current.win_rate = parseFloat(wr[1]);
      if (ret) current.ret      = parseFloat(ret[1]);
      if (tgt) current.target   = parseFloat(tgt[1]);
      if (stp) current.stop     = parseFloat(stp[1]);
      if (hld) current.hold     = parseFloat(hld[1]);

      if (line.trim() === '}' && current.win_rate !== undefined) {
        history.push(Object.assign({}, current));
        inHyp   = false;
        current = {};
      }
    }

    if (!history.length) return null;

    let totalWeight = 0;
    let wTarget = 0, wStop = 0, wHold = 0;
    let bestWR  = 0, bestRet = -Infinity;

    for (const h of history) {
      const retClamped = Math.max(0, Math.min(h.ret || 0, 100));
      const weight     = (h.win_rate / 100) * 0.6 + (retClamped / 100) * 0.4;
      wTarget     += (h.target || 13) * weight;
      wStop       += (h.stop   || 5)  * weight;
      wHold       += (h.hold   || 10) * weight;
      totalWeight += weight;
      if (h.win_rate       > bestWR)  bestWR  = h.win_rate;
      if ((h.ret || 0)     > bestRet) bestRet = h.ret || 0;
    }

    if (totalWeight === 0) return null;

    return {
      avgTarget:   Math.round(wTarget / totalWeight * 10) / 10,
      avgStop:     Math.round(wStop   / totalWeight * 10) / 10,
      avgHold:     Math.round(wHold   / totalWeight),
      bestWinRate: bestWR,
      bestReturn:  bestRet,
      count:       history.length
    };
  } catch (e) {
    return null;
  }
}

// ── Failure memory ─────────────────────────────────────────────────────────────

function loadFailures() {
  try {
    if (fs.existsSync(FAILURE_LOG)) {
      return JSON.parse(fs.readFileSync(FAILURE_LOG, 'utf8'))
        .slice(0, 3)
        .map(f => {
          return {
            name:     f.name,
            reason:   f.reason,
            win_rate: parseFloat(f.win_rate) || 0,
            ret:      parseFloat(f.return)   || 0,
            trades:   f.trades || 0
          };
        });
    }
  } catch (e) {}
  return [];
}

// ── Existing strategy ids ──────────────────────────────────────────────────────

function getExistingIds() {
  try {
    const content  = fs.readFileSync(SELECTOR_PATH, 'utf8');
    const matches  = content.match(/'([a-z0-9_]+)':\s*\{/g) || [];
    return matches.map(m => m.replace(/['{:\s]/g, ''));
  } catch (e) { return []; }
}

// ── Template selection ─────────────────────────────────────────────────────────

function selectTemplate(market, failures) {
  const allTemplates = Object.keys(TEMPLATES);
  const { regime, phase, sentiment } = market;

  let used = [];
  try {
    if (fs.existsSync(USED_FILE)) {
      used = JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
    }
  } catch (e) {}

  const candidates = [];
  if (sentiment === 'EXTREME_FEAR' || sentiment === 'FEAR')
    candidates.push('consecutive_red_rsi', 'oversold_bounce', 'mean_reversion_bollinger');
  if (regime === 'VOLATILE')
    candidates.push('volatility_breakout', 'oversold_bounce');
  if (regime === 'TRENDING_UP' || phase === 'MARKUP')
    candidates.push('trend_continuation');
  if (regime === 'RANGING' || regime === 'QUIET')
    candidates.push('mean_reversion_bollinger', 'consecutive_red_rsi');
  if (regime === 'TRENDING_DOWN' || phase === 'MARKDOWN')
    candidates.push('consecutive_red_rsi', 'oversold_bounce');
  if (!candidates.length)
    candidates.push('mean_reversion_bollinger');

  const recentFails = failures.map(f => f.name.toLowerCase());
  const existingIds = getExistingIds().map(id => id.toLowerCase());

  const filtered = candidates.filter(c => {
    const exists  = existingIds.some(id => id.includes(c.replace(/_/g, '')));
    const failed  = recentFails.some(fn => fn.includes(c.replace(/_/g, ' ')));
    const usedNow = used.includes(c);
    return !exists && !failed && !usedNow;
  });

  let selected;
  if (filtered.length) {
    selected = filtered[0];
  } else {
    const unused = allTemplates.filter(t => !used.includes(t));
    selected   = unused.length ? unused[0] : allTemplates[Math.floor(Date.now() / 1000) % allTemplates.length];
  }

  used.push(selected);
  if (used.length > allTemplates.length) used = [selected];

  try {
    fs.mkdirSync(path.dirname(USED_FILE), { recursive: true });
    fs.writeFileSync(USED_FILE, JSON.stringify(used));
  } catch (e) {}

  return selected;
}

// ── Parameter tuning ───────────────────────────────────────────────────────────

function tuneParameters(market, failures, history) {
  const { regime, phase, sentiment } = market;

  const baseTarget = history ? history.avgTarget : 13;
  const baseStop   = history ? history.avgStop   : 5;
  const baseHold   = history ? history.avgHold   : 10;

  const params = {
    regime,
    redDays:  3,
    rsiEntry: 35,
    rsiExit:  55,
    volEntry: 3.0,
    target:   baseTarget,
    stop:     baseStop,
    hold:     baseHold
  };

  if (regime === 'TRENDING_DOWN' || phase === 'MARKDOWN') {
    params.redDays  = 4;
    params.rsiEntry = 28;
    params.rsiExit  = 50;
    params.target   = Math.min(baseTarget * 0.9, 12);
    params.stop     = Math.min(baseStop   * 0.8, 6);
    params.hold     = Math.round(baseHold * 0.8);
  } else if (regime === 'VOLATILE') {
    params.volEntry = 3.5;
    params.target   = Math.min(baseTarget * 1.3, 25);
    params.stop     = Math.min(baseStop   * 1.2, 12);
    params.hold     = Math.round(baseHold * 0.7);
  } else if (regime === 'TRENDING_UP' || phase === 'MARKUP') {
    params.rsiEntry = 40;
    params.rsiExit  = 65;
    params.target   = Math.min(baseTarget * 0.9, 12);
    params.stop     = Math.min(baseStop   * 0.7, 5);
    params.hold     = Math.round(baseHold * 0.8);
  }

  if (sentiment === 'EXTREME_FEAR') {
    params.rsiEntry = Math.min(params.rsiEntry, 25);
    params.target   = Math.min(params.target * 1.2, 25);
  } else if (sentiment === 'EXTREME_GREED') {
    params.rsiEntry = 45;
    params.rsiExit  = 70;
  }

  for (const f of failures) {
    if (f.win_rate > 50 && f.ret < 0) {
      params.target = Math.min(params.target * 1.3, 25);
      params.hold   = Math.min(params.hold + 2, 14);
    }
    if (f.trades < 5) {
      params.rsiEntry = Math.min(params.rsiEntry + 5, 45);
      params.redDays  = Math.max(params.redDays  - 1,  2);
    }
    if (f.win_rate < 40) {
      params.rsiEntry = Math.max(params.rsiEntry - 5, 20);
    }
  }

  params.target   = Math.round(params.target   * 10) / 10;
  params.stop     = Math.round(params.stop     * 10) / 10;
  params.hold     = Math.round(params.hold);
  params.rsiEntry = Math.round(params.rsiEntry);
  params.rsiExit  = Math.round(params.rsiExit);

  return params;
}

// ── Build capsule ──────────────────────────────────────────────────────────────

function buildCapsule(hypothesis, market, failures) {
  const id        = 'hyp_' + hypothesis.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_' + Date.now().toString(36);
  const hash      = crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
  const timestamp = new Date().toISOString();
  const failNote  = failures.length
    ? 'Learned from ' + failures.length + ' failure(s): ' + failures.map(f => f.reason).join('; ')
    : 'No prior failures.';

  return {
    protocol: { name: 'Semantic Capsule Protocol', version: '1.0.0' },
    manifest: {
      id: id, name: hypothesis.name, version: '1.0.0',
      created: timestamp, type: 'generated_hypothesis',
      symbol: 'BTC/USD', exchange: 'kraken', capital: 1000,
      status: 'hypothesis',
      parameters: { targetPct: hypothesis.risk.target, stopPct: hypothesis.risk.stop, maxHoldDays: hypothesis.risk.hold },
      marketFit: {
        bestRegime: hypothesis.regime,
        generatedFor: { regime: market.regime, phase: market.phase, sentiment: market.sentiment, volatility: Math.round(market.volatility * 100) / 100 }
      },
      hash: hash
    },
    semantic_context: {
      regime:      hypothesis.regime,
      entry_rules: hypothesis.entry_rules,
      exit_rules:  hypothesis.exit_rules,
      risk_management: {
        position_size: '3% of capital',
        stop_loss:     '-' + hypothesis.risk.stop + '%',
        take_profit:   '+' + hypothesis.risk.target + '%',
        max_hold_days: hypothesis.risk.hold
      },
      performance_metrics: { confidence: 0.5 }
    },
    cognitive_layer: {
      intent:     'Exploit ' + hypothesis.regime + ' conditions with ' + market.sentiment + ' sentiment',
      philosophy: failNote,
      mantra:     market.sentiment + ' market. ' + hypothesis.regime + ' regime. Act accordingly.'
    },
    lineage: { parent: null, source: 'Forge Reasoning Engine', failures_considered: failures.length },
    lifecycle: { status: 'hypothesis', last_updated: timestamp },
    signature: { hash: hash, timestamp: timestamp }
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function reason(dryRun) {
  console.log('\n' + '═'.repeat(50));
  console.log('🧠 FORGE REASONING ENGINE');
  console.log('═'.repeat(50));

  console.log('👁️  Analysing market state...');
  const analyser = new MarketAnalyser();
  const market   = await analyser.analyse();
  console.log('   Regime:     ' + market.regime);
  console.log('   Phase:      ' + market.phase);
  console.log('   Sentiment:  ' + market.sentiment);
  console.log('   Volatility: ' + Math.round(market.volatility * 100) / 100 + '%');
  console.log('   BTC:        $' + (market.btcPrice || 0).toLocaleString());

  console.log('\n📊 Loading performance history...');
  const history = loadPerformanceHistory();
  if (history) {
    console.log('   ' + history.count + ' validated strategies');
    console.log('   Weighted avg — target: +' + history.avgTarget + '% | stop: -' + history.avgStop + '% | hold: ' + history.avgHold + 'd');
    console.log('   Best WR: ' + history.bestWinRate + '% | Best return: +' + history.bestReturn + '%');
  } else {
    console.log('   No history yet — using defaults');
  }

  console.log('\n📚 Loading failure memory...');
  const failures = loadFailures();
  if (failures.length) {
    failures.forEach(f => console.log('   • ' + f.name + ' — ' + f.reason));
  } else {
    console.log('   No failures recorded.');
  }

  console.log('\n⚡ Synthesising hypothesis...');
  const templateKey = selectTemplate(market, failures);
  const params      = tuneParameters(market, failures, history);
  const hypothesis  = TEMPLATES[templateKey](params);

  console.log('   Template:    ' + templateKey);
  console.log('   Name:        ' + hypothesis.name);
  console.log('   Entry rules: ' + hypothesis.entry_rules.join(' AND '));
  console.log('   Exit rules:  ' + hypothesis.exit_rules.join(' OR '));
  console.log('   Stop: -' + params.stop + '%  Target: +' + params.target + '%  Hold: ' + params.hold + 'd');

  const capsule = buildCapsule(hypothesis, market, failures);

  if (dryRun) {
    console.log('\n📋 DRY RUN — not saving');
    console.log(JSON.stringify(capsule, null, 2));
    return;
  }

  const dir  = path.join(SCP_PATH, capsule.manifest.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'capsule.json');
  fs.writeFileSync(file, JSON.stringify(capsule, null, 2));

  console.log('\n💾 Saved: ' + file);
  console.log('   ID: ' + capsule.manifest.id);
  console.log('\n▶️  Run validator: node forge-validator.js');
  console.log('═'.repeat(50));
}

const dryRun = process.argv.includes('--dry-run');
reason(dryRun).catch(console.error);
