#!/usr/bin/env node
/**
 * forge-monitor.js
 * Watches active_strategy.json and monitors entry/exit conditions.
 * Checks all 6 active trading pairs every 5 minutes.
 * Dry run only — logs signals, no real trades.
 *
 * Usage:
 *   node forge-monitor.js              (runs continuously)
 *   node forge-monitor.js --once       (single check then exit)
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const ACTIVE_STRATEGY  = path.join(__dirname, 'reasoning-bot/active_strategy.json');
const MONITOR_LOG      = path.join(__dirname, 'reasoning-bot/data/monitor_log.json');
const POLL_INTERVAL_MS = 5 * 60 * 1000;

// ── Trading pairs ──────────────────────────────────────────────────────────────

const TRADING_PAIRS = {
  'BTC/USD':  { kraken: 'XBTUSD',  tickers: ['XBTUSD', 'XXBTZUSD'] },
  'ETH/USD':  { kraken: 'ETHUSD',  tickers: ['ETHUSD', 'XETHZUSD'] },
  'SOL/USD':  { kraken: 'SOLUSD',  tickers: ['SOLUSD'] },
  'XRP/USD':  { kraken: 'XRPUSD',  tickers: ['XRPUSD', 'XXRPZUSD'] },
  'LINK/USD': { kraken: 'LINKUSD', tickers: ['LINKUSD'] },
  'LTC/USD':  { kraken: 'LTCUSD',  tickers: ['LTCUSD', 'XLTCZUSD'] },
  'DOGE/USD': { kraken: 'DOGEUSD', tickers: ['DOGEUSD'] },
  'ETH/BTC':  { kraken: 'ETHXBT',  tickers: ['ETHXBT', 'XETHXXBT'] }
};

// ── Kraken API ─────────────────────────────────────────────────────────────────

function httpsGet(url, retries = 3, backoff = 5000) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'Forge/1.0' } }, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode === 429 || res.statusCode >= 500) {
          if (retries > 0) {
            console.log(`   ⚠️ API Limit (${res.statusCode}). Retrying in ${Math.round(backoff/1000)}s...`);
            return setTimeout(() => resolve(httpsGet(url, retries - 1, backoff * 1.5)), backoff);
          }
          return reject(new Error(`HTTP ${res.statusCode}: Max retries reached`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) {
          if (retries > 0) {
            console.log(`   ⚠️ Parse Error (Cloudflare block?). Retrying in ${Math.round(backoff/1000)}s...`);
            return setTimeout(() => resolve(httpsGet(url, retries - 1, backoff * 1.5)), backoff);
          }
          reject(e);
        }
      });
    }).on('error', function(err) {
      if (retries > 0) {
        console.log(`   ⚠️ Network Error. Retrying in ${Math.round(backoff/1000)}s...`);
        return setTimeout(() => resolve(httpsGet(url, retries - 1, backoff * 1.5)), backoff);
      }
      reject(err);
    });
  });
}

async function fetchLivePrices(krakenPairs) {
  const url    = 'https://api.kraken.com/0/public/Ticker?pair=' + krakenPairs.join(',');
  const json   = await httpsGet(url);
  if (json.error && json.error.length) throw new Error(json.error[0]);
  const result = {};
  for (const key of Object.keys(json.result || {})) {
    result[key] = {
      price:  parseFloat(json.result[key].c[0]),
      high:   parseFloat(json.result[key].h[1]),
      low:    parseFloat(json.result[key].l[1]),
      volume: parseFloat(json.result[key].v[1])
    };
  }
  return result;
}

async function fetchOHLC(krakenPair, interval, limit) {
  interval = interval || 1440;
  limit    = limit    || 100;
  const url  = 'https://api.kraken.com/0/public/OHLC?pair=' + krakenPair + '&interval=' + interval;
  const json = await httpsGet(url);
  if (json.error && json.error.length) throw new Error(json.error[0]);
  const key  = Object.keys(json.result).find(function(k) { return k !== 'last'; });
  return (json.result[key] || []).slice(-limit).map(function(r) {
    return { timestamp: parseInt(r[0]), open: parseFloat(r[1]), high: parseFloat(r[2]), low: parseFloat(r[3]), close: parseFloat(r[4]), volume: parseFloat(r[6]) };
  });
}

// ── Indicators ─────────────────────────────────────────────────────────────────

function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

function calcMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  return closes.slice(-period).reduce(function(a, b) { return a + b; }, 0) / period;
}

function calcBollinger(closes, period) {
  period = period || 20;
  if (closes.length < period) return { upper: null, middle: null, lower: null };
  const w   = closes.slice(-period);
  const mid = w.reduce(function(a, b) { return a + b; }, 0) / period;
  const std = Math.sqrt(w.reduce(function(a, b) { return a + Math.pow(b - mid, 2); }, 0) / period);
  return { upper: mid + 2 * std, middle: mid, lower: mid - 2 * std };
}

function calcConsecRed(candles) {
  let count = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].close < candles[i].open) count++;
    else break;
  }
  return count;
}

// ── Rule evaluator ─────────────────────────────────────────────────────────────

function evaluateRule(rule, candles, currentPrice) {
  const rl     = rule.toLowerCase().trim();
  const closes = candles.map(function(c) { return c.close; });

  if (rl.includes('consecutive red')) {
    const m = rl.match(/(\d+)\s+consecutive red/);
    return calcConsecRed(candles) >= (m ? parseInt(m[1]) : 3);
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
    if (rl.includes('below lower')) return currentPrice < bb.lower;
    if (rl.includes('above upper')) return currentPrice > bb.upper;
  }
  if (rl.includes('ma(') || rl.includes('moving average')) {
    const pm = rl.match(/ma\((\d+)\)/);
    const ma = calcMA(closes, pm ? parseInt(pm[1]) : 50);
    if (rl.includes('price above') || rl.includes('above ma')) return currentPrice > ma;
    if (rl.includes('price below') || rl.includes('below ma')) return currentPrice < ma;
    if (rl.includes('ma(20) above ma(50)')) return calcMA(closes, 20) > calcMA(closes, 50);
  }
  return false;
}

// ── Load/save log ──────────────────────────────────────────────────────────────

function loadLog() {
  try {
    if (fs.existsSync(MONITOR_LOG)) return JSON.parse(fs.readFileSync(MONITOR_LOG, 'utf8'));
  } catch (e) {}
  return { positions: {}, trades: [], checks: 0 };
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(MONITOR_LOG), { recursive: true });
  fs.writeFileSync(MONITOR_LOG, JSON.stringify(log, null, 2));
}

// ── Get strategy rules ─────────────────────────────────────────────────────────

function getStrategyRules(stratId) {
  try {
    const scpBase = path.join(process.env.HOME, 'cce/engines/scp');
    const dirs    = fs.readdirSync(scpBase);
    const match   = dirs.find(function(d) { return d.includes(stratId.split('_').slice(0, 5).join('_')); });
    if (match) {
      const capsule    = JSON.parse(fs.readFileSync(path.join(scpBase, match, 'capsule.json'), 'utf8'));
      const ctx        = capsule.semantic_context || {};
      const risk       = ctx.risk_management || {};
      return {
        entryRules: ctx.entry_rules || [],
        exitRules:  ctx.exit_rules  || [],
        stopPct:    Math.abs(parseFloat(String(risk.stop_loss  || '-8').replace('%', ''))) || 8,
        targetPct:  Math.abs(parseFloat(String(risk.take_profit || '15').replace('%', '').replace('+', ''))) || 15,
        maxHold:    parseInt(risk.max_hold_days || 10) || 10
      };
    }
  } catch (e) {}
  return { entryRules: [], exitRules: [], stopPct: 8, targetPct: 15, maxHold: 10 };
}

// ── Check single pair ──────────────────────────────────────────────────────────

function checkPair(pair, currentPrice, candles, rules, log, ts) {
  const pos        = log.positions[pair];
  const label      = pair.padEnd(9);

  if (!pos) {
    if (!rules.entryRules.length) return;

    const entryMet = rules.entryRules.every(r => evaluateRule(r, candles, currentPrice));
    if (entryMet) {
      log.positions[pair] = {
        entered_at:   ts,
        entry_price:  currentPrice,
        target_price: Math.round(currentPrice * (1 + rules.targetPct / 100) * 100) / 100,
        stop_price:   Math.round(currentPrice * (1 - rules.stopPct   / 100) * 100) / 100,
        max_exit:     new Date(Date.now() + rules.maxHold * 24 * 60 * 60 * 1000).toISOString()
      };
      console.log(`\n   🟢 DRY RUN ENTRY: ${label} @ $${currentPrice.toLocaleString()}`);
      console.log(`      Target: $${log.positions[pair].target_price.toLocaleString()} (+${rules.targetPct}%)`);
      console.log(`      Stop:   $${log.positions[pair].stop_price.toLocaleString()} (-${rules.stopPct}%)`);
    }
  } else {
    const pnlPct    = Math.round((currentPrice - pos.entry_price) / pos.entry_price * 10000) / 100;
    const hitTarget = currentPrice >= pos.target_price;
    const hitStop   = currentPrice <= pos.stop_price;
    const hitTime   = new Date() >= new Date(pos.max_exit);
    const hitExit   = rules.exitRules.length ? rules.exitRules.some(r => evaluateRule(r, candles, currentPrice)) : false;

    const pnlStr = (pnlPct >= 0 ? '+' : '') + pnlPct + '%';
    console.log(`\n   📊 OPEN POSITION: ${label}`);
    console.log(`      Entry:   $${pos.entry_price.toLocaleString()}`);
    console.log(`      Current: $${currentPrice.toLocaleString()}`);
    console.log(`      P&L:     ${pnlStr}`);

    if (hitTarget || hitStop || hitTime || hitExit) {
      const reason = hitTarget ? 'take_profit' : hitStop ? 'stop_loss' : hitTime ? 'timeout' : 'exit_rule';
      const icon   = pnlPct > 0 ? '✅ WIN' : '❌ LOSS';
      console.log(`\n   ${icon} DRY RUN EXIT: ${label} @ $${currentPrice.toLocaleString()} (${pnlStr}) — ${reason}`);
      log.trades.push({ pair, entry_price: pos.entry_price, exit_price: currentPrice, pnl_pct: pnlPct, win: pnlPct > 0, reason, entered_at: pos.entered_at, exited_at: ts });
      delete log.positions[pair];
    }
  }
}

// ── Main check ─────────────────────────────────────────────────────────────────

async function check() {
  const ts = new Date().toISOString();
  console.log(`\n[${new Date().toLocaleTimeString()}] Checking...`);

  if (!fs.existsSync(ACTIVE_STRATEGY)) {
    console.log('   ⚠️  No active_strategy.json — run reasoning bot first.');
    return;
  }

  const active = JSON.parse(fs.readFileSync(ACTIVE_STRATEGY, 'utf8'));
  const log    = loadLog();
  log.checks++;

  console.log(`   🧠 Strategy: ${active.name}`);

  // Fetch all pair prices
  const krakenPairs = Object.values(TRADING_PAIRS).map(p => p.kraken);
  let prices, btcCandles;

  const isGrid   = active.strategy && active.strategy.includes('grid');
  const fetchInterval = isGrid ? 60 : 1440;
  const fetchLimit    = isGrid ? 100 : 60;

  try {
    [prices, btcCandles] = await Promise.all([
      fetchLivePrices(krakenPairs),
      fetchOHLC('XBTUSD', fetchInterval, fetchLimit)
    ]);
  } catch (e) {
    console.log('   Data fetch failed: ' + e.message);
    return;
  }

  // Log all prices
  console.log('   Prices:');
  for (const pair of Object.keys(TRADING_PAIRS)) {
    const info    = TRADING_PAIRS[pair];
    const ticker  = info.tickers.reduce(function(found, key) { return found || prices[key]; }, null);
    if (ticker) console.log('     ' + pair + ': $' + ticker.price.toLocaleString());
  }

  // Get strategy rules from SCP capsule
  const rules = getStrategyRules(active.strategy);

  if (!rules.entryRules.length) {
    console.log('   No semantic entry rules for this strategy');
    console.log('   Checks: ' + log.checks + ' | Trades: ' + log.trades.length);
    saveLog(log);
    return;
  }

  console.log('   Global Entry Rules:');
  rules.entryRules.forEach(function(r) {
    console.log('     — ' + r);
  });

  // Check all pairs independently
  for (const pair of Object.keys(TRADING_PAIRS)) {
    const info   = TRADING_PAIRS[pair];
    const ticker = info.tickers.reduce((found, key) => found || prices[key], null);
    if (!ticker) continue;

    // Fetch candles for this pair if not BTC
    let pairCandles = btcCandles;
    if (pair !== 'BTC/USD') {
      try { pairCandles = await fetchOHLC(info.kraken, fetchInterval, fetchLimit); } catch (e) { continue; }
    }

    checkPair(pair, ticker.price, pairCandles, rules, log, ts);
  }

  // Print running stats
  const wins = log.trades.filter(t => t.win).length;
  const wr   = log.trades.length ? Math.round(wins / log.trades.length * 100) : 0;
  console.log(`\n   📊 Stats: ${log.checks} checks | ${log.trades.length} trades` + (log.trades.length ? ` | WR: ${wr}%` : ''));

  saveLog(log);
}

// ── Entry ──────────────────────────────────────────────────────────────────────

const once = process.argv.includes('--once');

if (once) {
  check().catch(console.error);
} else {
  console.log('\n' + '═'.repeat(60));
  console.log('🔍 FORGE MONITOR — Multi-Pair Dry Run');
  console.log('═'.repeat(60));
  console.log(`   Pairs:    ${Object.keys(TRADING_PAIRS).join(', ')}`);
  console.log(`   Interval: ${POLL_INTERVAL_MS / 60000} minutes`);
  console.log('   Press Ctrl+C to stop\n');
  check().catch(console.error);
  setInterval(() => check().catch(console.error), POLL_INTERVAL_MS);
}
