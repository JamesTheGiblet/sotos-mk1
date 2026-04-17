// ============================================================
// THE LISTENER — Accumulation Engine Backtest
// Uses sql.js (pure JS SQLite — Termux compatible)
// ============================================================

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const PAIRS = ['XRP/USD', 'BTC/USD'];
const INTERVAL = '1D';

const CONFIG = {
  bb_period: 20,
  bb_squeeze_threshold: 0.14,
  rsi_period: 14,
  rsi_low: 35,
  rsi_high: 65,
  ma_50_period: 50,
  volume_lookback: 5,
  no_new_lows_period: 10,
  forward_windows: [7, 14, 30],
};

function calcSMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcBollingerBands(closes, period) {
  const sma = calcSMA(closes, period);
  return closes.map((_, i) => {
    if (i < period - 1) return { width: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const std = Math.sqrt(slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    return { upper, lower, width: (upper - lower) / mean, mid: mean };
  });
}

function calcRSI(closes, period) {
  return closes.map((_, i) => {
    if (i < period) return null;
    const slice = closes.slice(i - period, i + 1);
    let gains = 0, losses = 0;
    for (let j = 1; j < slice.length; j++) {
      const diff = slice[j] - slice[j - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  });
}

function isVolumeAccumulating(candles, i) {
  if (i < CONFIG.volume_lookback) return false;
  const slice = candles.slice(i - CONFIG.volume_lookback, i + 1);
  let gVol = 0, gCount = 0, rVol = 0, rCount = 0;
  slice.forEach(c => {
    if (c.close > c.open) { gVol += c.volume; gCount++; }
    else { rVol += c.volume; rCount++; }
  });
  if (gCount === 0 || rCount === 0) return false;
  return (gVol / gCount) > (rVol / rCount);
}

function isNoNewLows(candles, i) {
  if (i < CONFIG.no_new_lows_period) return false;
  const slice = candles.slice(i - CONFIG.no_new_lows_period, i);
  return candles[i].low >= Math.min(...slice.map(c => c.low));
}

function measureOutcome(candles, idx, days) {
  const entry = candles[idx].close;
  const futureIdx = idx + days;
  if (futureIdx >= candles.length) return null;
  const exit = candles[futureIdx].close;
  const slice = candles.slice(idx, futureIdx + 1);
  const highest = Math.max(...slice.map(c => c.close));
  const lowest = Math.min(...slice.map(c => c.close));
  return {
    returnPct:    parseFloat(((exit - entry) / entry * 100).toFixed(2)),
    breakoutPct:  parseFloat(((highest - entry) / entry * 100).toFixed(2)),
    breakdownPct: parseFloat(((lowest - entry) / entry * 100).toFixed(2)),
  };
}

function runBacktest(db, pair) {
  const stmt = db.prepare(
    'SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC'
  );
  stmt.bind([pair, INTERVAL]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  if (rows.length < 60) {
    console.log('  Not enough data for ' + pair);
    return;
  }

  const closes = rows.map(r => r.close);
  const bb   = calcBollingerBands(closes, CONFIG.bb_period);
  const rsi  = calcRSI(closes, CONFIG.rsi_period);
  const ma50 = calcSMA(closes, CONFIG.ma_50_period);

  const signals = [];

  for (let i = CONFIG.ma_50_period; i < rows.length - 30; i++) {
    const c1 = bb[i].width !== null && bb[i].width < CONFIG.bb_squeeze_threshold;
    const c2 = isVolumeAccumulating(rows, i);
    const c3 = rsi[i] !== null && rsi[i] >= CONFIG.rsi_low && rsi[i] <= CONFIG.rsi_high;
    const c4 = ma50[i] !== null && closes[i] > ma50[i];
    const c5 = isNoNewLows(rows, i);

    if (c1 && c2 && c3 && c4 && c5) {
      const date = new Date(rows[i].timestamp * 1000).toISOString().split('T')[0];
      const outcomes = {};
      CONFIG.forward_windows.forEach(d => {
        outcomes[d + 'd'] = measureOutcome(rows, i, d);
      });
      signals.push({ date, price: closes[i], outcomes });
    }
  }

  console.log('\n' + '='.repeat(58));
  console.log('  THE LISTENER -- ' + pair);
  console.log('  ' + rows.length + ' candles | ' + signals.length + ' accumulation signals');
  console.log('='.repeat(58));

  if (signals.length === 0) {
    console.log('  No signals -- conditions may be too strict.');
    return;
  }

  CONFIG.forward_windows.forEach(function(days) {
    const outcomes = signals.map(s => s.outcomes[days + 'd']).filter(Boolean);
    if (!outcomes.length) return;
    const wins = outcomes.filter(o => o.returnPct > 0).length;
    const avg = function(v) {
      return (outcomes.reduce((s, o) => s + o[v], 0) / outcomes.length).toFixed(2);
    };
    console.log('\n  -- ' + days + '-Day Outcome --');
    console.log('  Signals   : ' + outcomes.length);
    console.log('  Win rate  : ' + ((wins / outcomes.length) * 100).toFixed(1) + '%');
    console.log('  Avg return: ' + avg('returnPct') + '%');
    console.log('  Peak gain : +' + avg('breakoutPct') + '%');
    console.log('  Max dip   : ' + avg('breakdownPct') + '%');
  });

  console.log('\n  -- Recent Signals --');
  signals.slice(-20).forEach(function(s) {
    var o7  = s.outcomes['7d'];
    var o30 = s.outcomes['30d'];
    var t7  = o7  ? '7d:'  + (o7.returnPct  >= 0 ? '+' : '') + o7.returnPct  + '%' : '7d:n/a ';
    var t30 = o30 ? '30d:' + (o30.returnPct >= 0 ? '+' : '') + o30.returnPct + '%' : '30d:n/a';
    console.log('  ' + s.date + '  $' + s.price.toFixed(4) + '  ' + t7 + '  ' + t30);
  });
}

async function main() {
  console.log('\n THE LISTENER -- Accumulation Backtest');
  console.log('C1: BB squeeze <14%  C2: Volume sig  C3: RSI 35-65  C4: Above 50MA  C5: No new lows\n');
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  for (var i = 0; i < PAIRS.length; i++) {
    runBacktest(db, PAIRS[i]);
  }
  db.close();
  console.log('');
}

main().catch(console.error);
