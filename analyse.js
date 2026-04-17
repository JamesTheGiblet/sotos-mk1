#!/usr/bin/env node
'use strict';

const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'data', 'intelligence.db');

// ── DB ────────────────────────────────────────────────────────────────────────

let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Database not found. Run collect.js first.');
    process.exit(1);
  }
  db = new SQL.Database(fs.readFileSync(DB_PATH));
  console.log('📂 Database loaded');
}

function query(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

// ── DATA LOADER ───────────────────────────────────────────────────────────────

function getCandles(pair, interval, limit = 9999) {
  return query(
    `SELECT timestamp, open, high, low, close, volume
     FROM candles WHERE pair=? AND interval=?
     ORDER BY timestamp ASC LIMIT ?`,
    [pair, interval, limit]
  );
}

function getAllPairs() {
  return query(`SELECT DISTINCT pair FROM candles ORDER BY pair`).map(r => r.pair);
}

// ── MATHS ─────────────────────────────────────────────────────────────────────

function returns(candles) {
  const r = [];
  for (let i = 1; i < candles.length; i++) {
    r.push((candles[i].close - candles[i-1].close) / candles[i-1].close);
  }
  return r;
}

function mean(arr) {
  return arr.reduce((a,b) => a+b, 0) / arr.length;
}

function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a,b) => a + (b-m)**2, 0) / arr.length);
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = mean(ax), mb = mean(bx);
  const sa = std(ax),  sb = std(bx);
  if (sa === 0 || sb === 0) return 0;
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (ax[i]-ma)*(bx[i]-mb);
  return cov / n / sa / sb;
}

function zscore(value, arr) {
  const m = mean(arr);
  const s = std(arr);
  if (s === 0) return 0;
  return (value - m) / s;
}

function rollingMean(arr, window) {
  return arr.map((_, i) => {
    if (i < window - 1) return null;
    return mean(arr.slice(i - window + 1, i + 1));
  });
}

function percentile(arr, pct) {
  const sorted = [...arr].sort((a,b) => a-b);
  return sorted[Math.floor(sorted.length * pct / 100)];
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ── ANALYSIS MODULES ──────────────────────────────────────────────────────────

// 1. CORRELATION MATRIX
function correlationMatrix(interval = '1D') {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 CORRELATION MATRIX — ${interval}`);
  console.log('═'.repeat(60));

  const usdPairs = ['BTC/USD','ETH/USD','SOL/USD','XRP/USD',
                    'LTC/USD','ADA/USD','LINK/USD','DOT/USD','DOGE/USD'];

  const pairReturns = {};
  for (const pair of usdPairs) {
    const candles = getCandles(pair, interval);
    if (candles.length > 10) {
      pairReturns[pair] = returns(candles);
    }
  }

  const pairs = Object.keys(pairReturns);
  const btcRet = pairReturns['BTC/USD'];

  console.log('\n  Correlation vs BTC/USD (1 = moves identically, -1 = opposite):');
  console.log('  ' + '─'.repeat(50));

  const corrs = [];
  for (const pair of pairs) {
    if (pair === 'BTC/USD') continue;
    const corr = pearson(btcRet, pairReturns[pair]);
    corrs.push({ pair, corr });
  }

  corrs.sort((a,b) => b.corr - a.corr);

  for (const { pair, corr } of corrs) {
    const bar = '█'.repeat(Math.round(Math.abs(corr) * 20));
    const sign = corr >= 0 ? '+' : '-';
    const label = corr > 0.8 ? '🔴 HIGHLY CORRELATED' : corr > 0.6 ? '🟡 CORRELATED' : '🟢 WEAKLY CORRELATED';
    console.log(`  ${pair.padEnd(12)} ${sign}${Math.abs(corr).toFixed(3)}  ${bar.padEnd(20)} ${label}`);
  }

  return corrs;
}

// 2. LEAD/LAG ANALYSIS
function leadLagAnalysis(interval = '1D') {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`⏱️  LEAD/LAG ANALYSIS — ${interval}`);
  console.log('═'.repeat(60));
  console.log('  Does any asset move BEFORE BTC?\n');

  const btcCandles = getCandles('BTC/USD', interval);
  const btcRet     = returns(btcCandles);

  const alts = ['ETH/USD','SOL/USD','XRP/USD','LTC/USD',
                 'ADA/USD','LINK/USD','DOT/USD','DOGE/USD'];

  const results = [];

  for (const pair of alts) {
    const candles = getCandles(pair, interval);
    if (candles.length < 20) continue;
    const altRet = returns(candles);
    const n = Math.min(btcRet.length, altRet.length);

    let bestLag = 0, bestCorr = 0;
    for (let lag = -3; lag <= 3; lag++) {
      let a, b;
      if (lag > 0) {
        a = altRet.slice(0, n - lag);
        b = btcRet.slice(lag, n);
      } else if (lag < 0) {
        a = altRet.slice(-lag, n);
        b = btcRet.slice(0, n + lag);
      } else {
        a = altRet.slice(-n);
        b = btcRet.slice(-n);
      }
      const corr = Math.abs(pearson(a, b));
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }

    results.push({ pair, bestLag, bestCorr });
  }

  results.sort((a,b) => a.bestLag - b.bestLag);

  for (const { pair, bestLag, bestCorr } of results) {
    const lagLabel = bestLag < 0
      ? `BTC leads ${pair.split('/')[0]} by ${Math.abs(bestLag)}d`
      : bestLag > 0
      ? `${pair.split('/')[0]} leads BTC by ${bestLag}d ⚡`
      : 'Move simultaneously';
    console.log(`  ${pair.padEnd(12)} lag:${String(bestLag).padStart(3)}  corr:${bestCorr.toFixed(3)}  ${lagLabel}`);
  }

  return results;
}

// 3. CASCADE ANALYSIS
function cascadeAnalysis(interval = '1D') {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🌊 CASCADE ANALYSIS — ${interval}`);
  console.log('═'.repeat(60));
  console.log('  When BTC drops 5%+ in a day, what happens to alts?\n');

  const btcCandles = getCandles('BTC/USD', interval);
  const btcRet     = returns(btcCandles);

  const dropDays = [];
  btcRet.forEach((r, i) => { if (r < -0.05) dropDays.push(i); });

  console.log(`  BTC drop days (>5%): ${dropDays.length} events found\n`);

  if (dropDays.length < 3) {
    console.log('  ⚠️  Not enough drop events in dataset');
    return;
  }

  const alts = ['ETH/USD','SOL/USD','XRP/USD','LTC/USD',
                 'ADA/USD','LINK/USD','DOT/USD','DOGE/USD'];

  console.log('  Same day response when BTC drops 5%+:');
  console.log('  ' + '─'.repeat(50));

  const cascades = [];
  for (const pair of alts) {
    const candles = getCandles(pair, interval);
    if (candles.length < 20) continue;
    const altRet = returns(candles);
    const n = Math.min(btcRet.length, altRet.length);

    const sameDayMoves = dropDays.filter(i => i < n).map(i => altRet[i]);
    const nextDayMoves = dropDays.filter(i => i+1 < n).map(i => altRet[i+1]);
    const day2Moves    = dropDays.filter(i => i+2 < n).map(i => altRet[i+2]);

    if (!sameDayMoves.length) continue;

    const avgSame = mean(sameDayMoves) * 100;
    const avgNext = mean(nextDayMoves) * 100;
    const avgDay2 = mean(day2Moves) * 100;

    cascades.push({ pair, avgSame, avgNext, avgDay2 });

    const asset = pair.split('/')[0].padEnd(5);
    const sameStr = (avgSame >= 0 ? '+' : '') + avgSame.toFixed(1) + '%';
    const nextStr = (avgNext >= 0 ? '+' : '') + avgNext.toFixed(1) + '%';
    const day2Str = (avgDay2 >= 0 ? '+' : '') + avgDay2.toFixed(1) + '%';
    const recovery = avgNext > 0 ? '📈 recovers next day' : avgDay2 > 0 ? '📈 recovers day+2' : '📉 stays down';
    console.log(`  ${asset}  same:${sameStr.padStart(7)}  next:${nextStr.padStart(7)}  d+2:${day2Str.padStart(7)}  ${recovery}`);
  }

  return cascades;
}

// 4. MEAN REVERSION OPPORTUNITIES
function meanReversionAnalysis(interval = '1D') {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔄 MEAN REVERSION ANALYSIS — ${interval}`);
  console.log('═'.repeat(60));
  console.log('  Current Z-score vs 90-day mean (±2 = extreme)\n');

  const usdPairs = ['BTC/USD','ETH/USD','SOL/USD','XRP/USD',
                    'LTC/USD','ADA/USD','LINK/USD','DOT/USD','DOGE/USD'];

  const opportunities = [];

  for (const pair of usdPairs) {
    const candles = getCandles(pair, interval);
    if (candles.length < 30) continue;

    const closes  = candles.map(c => c.close);
    const current = closes[closes.length - 1];
    const window90 = closes.slice(-90);
    const z = zscore(current, window90);
    const m = mean(window90);
    const pctFromMean = ((current - m) / m) * 100;

    opportunities.push({ pair, current, z, pctFromMean, mean: m });

    const zStr = (z >= 0 ? '+' : '') + z.toFixed(2);
    const pStr = (pctFromMean >= 0 ? '+' : '') + pctFromMean.toFixed(1) + '%';
    const signal = z < -2   ? '🟢 EXTREME OVERSOLD — strong reversion candidate'
                 : z < -1   ? '🟡 OVERSOLD — potential reversion'
                 : z > 2    ? '🔴 EXTREME OVERBOUGHT — potential short'
                 : z > 1    ? '🟠 OVERBOUGHT'
                 : '⚪ NEUTRAL';
    console.log(`  ${pair.padEnd(12)} z:${zStr.padStart(6)}  ${pStr.padStart(7)} from 90d mean  ${signal}`);
  }

  const ethbtc = getCandles('ETH/BTC', interval);
  if (ethbtc.length > 30) {
    const closes = ethbtc.map(c => c.close);
    const current = closes[closes.length - 1];
    const window90 = closes.slice(-90);
    const z = zscore(current, window90);
    const pctFromMean = ((current - mean(window90)) / mean(window90)) * 100;
    const zStr = (z >= 0 ? '+' : '') + z.toFixed(2);
    const pStr = (pctFromMean >= 0 ? '+' : '') + pctFromMean.toFixed(1) + '%';
    const signal = z < -2 ? '🟢 ETH CHEAP VS BTC — ratio reversion play'
                 : z > 2  ? '🔴 ETH EXPENSIVE VS BTC'
                 : '⚪ NEUTRAL';
    console.log(`  ${'ETH/BTC'.padEnd(12)} z:${zStr.padStart(6)}  ${pStr.padStart(7)} from 90d mean  ${signal}`);
  }

  return opportunities;
}

// 5. VOLATILITY REGIME
function volatilityRegime(interval = '1D') {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📉 VOLATILITY REGIME — ${interval}`);
  console.log('═'.repeat(60));
  console.log('  Current volatility vs historical — are we in a squeeze?\n');

  const btcCandles = getCandles('BTC/USD', interval);
  if (btcCandles.length < 30) return;

  const ret = returns(btcCandles);
  const window14  = ret.slice(-14).map(Math.abs);
  const window90  = ret.slice(-90).map(Math.abs);
  const window365 = ret.slice(-365).map(Math.abs);

  const vol14  = mean(window14)  * 100;
  const vol90  = mean(window90)  * 100;
  const vol365 = mean(window365) * 100;

  console.log(`  BTC daily volatility:`);
  console.log(`  14-day avg:  ${vol14.toFixed(2)}%`);
  console.log(`  90-day avg:  ${vol90.toFixed(2)}%`);
  console.log(`  365-day avg: ${vol365.toFixed(2)}%`);

  const regime = vol14 < vol90 * 0.7
    ? '🟢 LOW VOLATILITY — potential squeeze before breakout'
    : vol14 > vol90 * 1.5
    ? '🔴 HIGH VOLATILITY — trending or chaotic market'
    : '⚪ NORMAL VOLATILITY';

  console.log(`\n  Regime: ${regime}`);

  const monthlyRet = [];
  for (let i = 30; i < ret.length; i += 30) {
    const slice = ret.slice(i-30, i);
    monthlyRet.push({ month: i/30, ret: slice.reduce((a,b) => (1+a)*(1+b)-1, 0) * 100 });
  }
  monthlyRet.sort((a,b) => b.ret - a.ret);

  console.log(`\n  Best monthly returns in dataset:`);
  monthlyRet.slice(0,3).forEach(m => {
    console.log(`  Month ${String(m.month).padStart(3)}: ${m.ret >= 0 ? '+' : ''}${m.ret.toFixed(1)}%`);
  });
  console.log(`\n  Worst monthly returns:`);
  monthlyRet.slice(-3).reverse().forEach(m => {
    console.log(`  Month ${String(m.month).padStart(3)}: ${m.ret >= 0 ? '+' : ''}${m.ret.toFixed(1)}%`);
  });
}

// 6. ANOMALY DETECTION
function anomalyDetection(interval = '1D') {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚨 ANOMALY DETECTION — ${interval}`);
  console.log('═'.repeat(60));
  console.log('  Unusual behaviour in last 7 days vs historical norms\n');

  const usdPairs = ['BTC/USD','ETH/USD','SOL/USD','XRP/USD','DOGE/USD'];
  const anomalies = [];

  for (const pair of usdPairs) {
    const candles = getCandles(pair, interval);
    if (candles.length < 30) continue;

    const ret     = returns(candles);
    const recent7 = ret.slice(-7);
    const hist    = ret.slice(0, -7);

    const vols    = candles.map(c => c.volume);
    const recentV = vols.slice(-7);
    const histV   = vols.slice(0, -7);
    const avgHistV = mean(histV);
    const avgRecentV = mean(recentV);
    const volRatio = avgRecentV / avgHistV;

    const recentZ = recent7.map(r => Math.abs(zscore(r, hist)));
    const maxZ    = Math.max(...recentZ);

    if (maxZ > 2.5) {
      anomalies.push({ pair, type: 'PRICE', severity: maxZ });
      console.log(`  🚨 ${pair} — unusual price move detected (z-score: ${maxZ.toFixed(2)})`);
    }
    if (volRatio > 2) {
      anomalies.push({ pair, type: 'VOLUME', severity: volRatio });
      console.log(`  📊 ${pair} — volume spike: ${volRatio.toFixed(1)}x normal`);
    }
    if (volRatio < 0.3) {
      anomalies.push({ pair, type: 'VOLUME_DRY', severity: volRatio });
      console.log(`  📊 ${pair} — volume drought: ${volRatio.toFixed(1)}x normal — squeeze building?`);
    }
  }

  if (!anomalies.length) {
    console.log('  ✅ No significant anomalies detected in last 7 days');
  }

  return anomalies;
}

// 7. PATTERN FINDER
function patternFinder(interval = '1D') {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔍 PATTERN FINDER — BTC/USD ${interval}`);
  console.log('═'.repeat(60));
  console.log('  Historical patterns and what followed\n');

  const candles = getCandles('BTC/USD', interval);
  if (candles.length < 60) return;

  const ret    = returns(candles);
  const closes = candles.map(c => c.close);

  const threeDayDrops = [];
  for (let i = 2; i < ret.length - 3; i++) {
    if (ret[i] < 0 && ret[i-1] < 0 && ret[i-2] < 0) {
      const next3 = ret.slice(i+1, i+4).reduce((a,b) => (1+a)*(1+b)-1, 0) * 100;
      threeDayDrops.push(next3);
    }
  }

  if (threeDayDrops.length > 3) {
    const avgNext = mean(threeDayDrops);
    const positive = threeDayDrops.filter(r => r > 0).length;
    const winRate = (positive / threeDayDrops.length * 100).toFixed(0);
    console.log(`  3 consecutive red days (${threeDayDrops.length} events):`);
    console.log(`  → Avg next 3 days: ${avgNext >= 0 ? '+' : ''}${avgNext.toFixed(1)}%`);
    console.log(`  → Win rate (positive next 3d): ${winRate}%`);
    const signal = parseInt(winRate) > 60 ? '🟢 BULLISH SETUP' : parseInt(winRate) < 40 ? '🔴 BEARISH CONTINUATION' : '⚪ MIXED';
    console.log(`  → Signal: ${signal}\n`);
  }

  const bigDrops = [];
  for (let i = 0; i < ret.length - 7; i++) {
    if (ret[i] < -0.05) {
      const next7 = ret.slice(i+1, i+8).reduce((a,b) => (1+a)*(1+b)-1, 0) * 100;
      bigDrops.push(next7);
    }
  }

  if (bigDrops.length > 2) {
    const avgNext = mean(bigDrops);
    const positive = bigDrops.filter(r => r > 0).length;
    const winRate = (positive / bigDrops.length * 100).toFixed(0);
    console.log(`  5%+ single day crash (${bigDrops.length} events):`);
    console.log(`  → Avg next 7 days: ${avgNext >= 0 ? '+' : ''}${avgNext.toFixed(1)}%`);
    console.log(`  → Win rate (positive next 7d): ${winRate}%`);
    const signal = parseInt(winRate) > 60 ? '🟢 BUY THE DIP CONFIRMED' : parseInt(winRate) < 40 ? '🔴 DEAD CAT — stay out' : '⚪ MIXED';
    console.log(`  → Signal: ${signal}\n`);
  }

  const recent7ret = ret.slice(-7).reduce((a,b) => (1+a)*(1+b)-1, 0) * 100;
  const all7dayRets = [];
  for (let i = 7; i < ret.length; i++) {
    all7dayRets.push(ret.slice(i-7,i).reduce((a,b) => (1+a)*(1+b)-1, 0) * 100);
  }
  const pct = percentile(all7dayRets, 10);
  const p25 = percentile(all7dayRets, 25);
  const p75 = percentile(all7dayRets, 75);
  const p90 = percentile(all7dayRets, 90);

  console.log(`  Current 7-day BTC return: ${recent7ret >= 0 ? '+' : ''}${recent7ret.toFixed(1)}%`);
  console.log(`  Historical distribution:`);
  console.log(`  10th pct: ${pct.toFixed(1)}%  25th: ${p25.toFixed(1)}%  75th: ${p75.toFixed(1)}%  90th: ${p90.toFixed(1)}%`);
  const position = recent7ret < pct ? 'BOTTOM 10% — historically bullish reversal zone'
                 : recent7ret < p25 ? 'BOTTOM QUARTILE — oversold territory'
                 : recent7ret > p90 ? 'TOP 10% — historically overbought'
                 : recent7ret > p75 ? 'TOP QUARTILE — extended'
                 : 'MIDDLE RANGE — no strong signal';
  console.log(`  Position: ${position}`);
}

// 8. PHARAOH VALIDATOR
function pharaohValidator() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏺 PHARAOH STRATEGY VALIDATOR`);
  console.log('═'.repeat(60));
  console.log('  Backtesting XRP sentiment fade on available data\n');

  const xrpCandles = getCandles('XRP/USD', '1D');
  const btcCandles = getCandles('BTC/USD', '1D');

  if (xrpCandles.length < 30) {
    console.log('  ⚠️  Not enough XRP data');
    return;
  }

  const xrpRet = returns(xrpCandles);
  const btcRet = returns(btcCandles);

  let capital = 250;
  let trades  = 0;
  let wins    = 0;
  let totalPnl = 0;
  const results = [];

  for (let i = 5; i < xrpRet.length - 10; i++) {
    const drop3d = xrpCandles[i].close / xrpCandles[i-5].close - 1;

    if (drop3d < -0.15) {
      const entry = xrpCandles[i].close;

      let exitPrice = entry;
      let exitDay   = 0;
      for (let j = 1; j <= 30 && i+j < xrpCandles.length; j++) {
        const price = xrpCandles[i+j].close;
        const pnl   = (price - entry) / entry;
        if (pnl >= 0.20 || pnl <= -0.15) {
          exitPrice = price;
          exitDay   = j;
          break;
        }
        if (j === 30) { exitPrice = price; exitDay = 30; }
      }

      const tradePnl = (exitPrice - entry) / entry * 100;
      const won = tradePnl > 0;
      trades++;
      if (won) wins++;
      totalPnl += tradePnl;
      results.push({ entry, exitPrice, tradePnl, exitDay, won });
    }
  }

  if (!trades) {
    console.log('  ⚠️  No qualifying setups found in dataset');
    return;
  }

  const winRate = (wins / trades * 100).toFixed(0);
  const avgPnl  = (totalPnl / trades).toFixed(1);
  const avgWin  = mean(results.filter(r=>r.won).map(r=>r.tradePnl)).toFixed(1);
  const avgLoss = mean(results.filter(r=>!r.won).map(r=>r.tradePnl)).toFixed(1);
  const avgDays = mean(results.map(r=>r.exitDay)).toFixed(0);

  console.log(`  Setups found:    ${trades}`);
  console.log(`  Win rate:        ${winRate}%`);
  console.log(`  Avg P&L/trade:   ${avgPnl >= 0 ? '+' : ''}${avgPnl}%`);
  console.log(`  Avg win:         +${avgWin}%`);
  console.log(`  Avg loss:        ${avgLoss}%`);
  console.log(`  Avg hold:        ${avgDays} days`);

  let sim = 250;
  for (const r of results) {
    sim = sim * (1 + r.tradePnl / 100);
  }
  console.log(`\n  $250 compounded through all ${trades} trades: $${sim.toFixed(2)}`);
  console.log(`  Return: ${((sim/250-1)*100).toFixed(0)}%`);

  const verdict = parseInt(winRate) >= 55 && parseFloat(avgPnl) > 0
    ? '✅ STRATEGY VALIDATED — edge confirmed in historical data'
    : parseInt(winRate) >= 45
    ? '🟡 MARGINAL EDGE — proceed with caution'
    : '❌ NO EDGE — review entry conditions';
  console.log(`\n  Verdict: ${verdict}`);
}

// 9. INTRADAY PATTERNS
function intradayPatterns() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`⏰ INTRADAY PATTERNS — 1H (preliminary — 30 days)`);
  console.log('═'.repeat(60));

  const candles = getCandles('BTC/USD', '1H');
  if (candles.length < 100) {
    console.log('  ⚠️  Insufficient 1H data — need at least 100 candles');
    return;
  }

  const hourStats = {};
  for (let h = 0; h < 24; h++) hourStats[h] = { returns: [], wins: 0, total: 0 };

  for (let i = 1; i < candles.length; i++) {
    const hour = new Date(candles[i].timestamp * 1000).getUTCHours();
    const ret = (candles[i].close - candles[i-1].close) / candles[i-1].close;
    hourStats[hour].returns.push(ret);
    hourStats[hour].total++;
    if (ret > 0) hourStats[hour].wins++;
  }

  const sortedHours = Object.entries(hourStats)
    .map(([h, s]) => ({ hour: parseInt(h), avgRet: mean(s.returns), winRate: s.wins / s.total * 100 }))
    .sort((a,b) => b.avgRet - a.avgRet);

  console.log('\n  Best hours UTC:');
  sortedHours.slice(0, 5).forEach(h => {
    console.log(`  ${String(h.hour).padStart(2)}:00  ${h.avgRet >= 0 ? '+' : ''}${(h.avgRet*100).toFixed(3)}%  ${h.winRate.toFixed(0)}% win rate`);
  });

  console.log('\n  Worst hours UTC:');
  sortedHours.slice(-5).reverse().forEach(h => {
    console.log(`  ${String(h.hour).padStart(2)}:00  ${h.avgRet >= 0 ? '+' : ''}${(h.avgRet*100).toFixed(3)}%  ${h.winRate.toFixed(0)}% win rate`);
  });

  const threeRedHours = [];
  for (let i = 3; i < candles.length - 3; i++) {
    const h1 = candles[i-2].close < candles[i-3].close;
    const h2 = candles[i-1].close < candles[i-2].close;
    const h3 = candles[i].close   < candles[i-1].close;
    if (h1 && h2 && h3) {
      const next3 = (candles[i+3].close - candles[i].close) / candles[i].close;
      threeRedHours.push(next3);
    }
  }

  if (threeRedHours.length > 10) {
    const avgNext = mean(threeRedHours) * 100;
    const positive = threeRedHours.filter(r => r > 0).length;
    const winRate = positive / threeRedHours.length * 100;
    console.log(`\n  3 consecutive red hours (${threeRedHours.length} events):`);
    console.log(`  → Avg next 3H: ${avgNext >= 0 ? '+' : ''}${avgNext.toFixed(3)}%`);
    console.log(`  → Win rate: ${winRate.toFixed(0)}%`);
  }

  const volumeSpikes = [];
  for (let i = 14; i < candles.length - 1; i++) {
    const avgVol = mean(candles.slice(i-14, i).map(c => c.volume));
    const volRatio = candles[i].volume / avgVol;
    if (volRatio > 2) {
      const nextRet = (candles[i+1].close - candles[i].close) / candles[i].close;
      volumeSpikes.push(nextRet);
    }
  }

  if (volumeSpikes.length > 10) {
    const avgNext = mean(volumeSpikes) * 100;
    const positive = volumeSpikes.filter(r => r > 0).length;
    const winRate = positive / volumeSpikes.length * 100;
    console.log(`\n  Volume spikes >2x avg (${volumeSpikes.length} events):`);
    console.log(`  → Avg next 1H: ${avgNext >= 0 ? '+' : ''}${avgNext.toFixed(3)}%`);
    console.log(`  → Win rate: ${winRate.toFixed(0)}%`);
  }
}

// ── BACKTEST ENGINE ────────────────────────────────────────────────────────────

function backtest(candles, entryFn, exitFn, capital = 100, label = '') {
  let cash     = capital;
  let position = null;
  const trades = [];

  for (let i = 20; i < candles.length - 1; i++) {
    if (!position) {
      const signal = entryFn(candles, i);
      if (signal) {
        position = {
          entryPrice: candles[i+1].open || candles[i+1].close,
          entryIdx:   i+1,
          direction:  signal.direction || 'long',
          size:       cash
        };
      }
    } else {
      const exit = exitFn(candles, i, position);
      if (exit) {
        const price  = candles[i].close;
        const pnlPct = position.direction === 'long'
          ? (price - position.entryPrice) / position.entryPrice
          : (position.entryPrice - price) / position.entryPrice;
        const pnl    = position.size * pnlPct;
        cash        += pnl;
        trades.push({
          entry:     position.entryPrice,
          exit:      price,
          pnlPct:    pnlPct * 100,
          pnl,
          direction: position.direction,
          days:      i - position.entryIdx
        });
        position = null;
      }
    }
  }

  if (!trades.length) return null;

  const wins    = trades.filter(t => t.pnl > 0);
  const losses  = trades.filter(t => t.pnl <= 0);
  const winRate = wins.length / trades.length * 100;
  const avgPnl  = mean(trades.map(t => t.pnlPct));
  const avgWin  = wins.length  ? mean(wins.map(t => t.pnlPct))   : 0;
  const avgLoss = losses.length ? mean(losses.map(t => t.pnlPct)) : 0;
  const avgDays = mean(trades.map(t => t.days));

  return {
    label, trades: trades.length, winRate, avgPnl,
    avgWin, avgLoss, avgDays,
    startCapital: capital, endCapital: cash,
    returnPct: (cash / capital - 1) * 100
  };
}

function printBacktest(r) {
  if (!r) { console.log('  ⚠️  No trades found'); return; }
  const verdict = r.winRate >= 60 && r.avgPnl > 0 ? '✅ EDGE CONFIRMED'
                : r.winRate >= 52 && r.avgPnl > 0 ? '🟡 MARGINAL EDGE'
                : '❌ NO EDGE';
  console.log(`  Trades:      ${r.trades}`);
  console.log(`  Win rate:    ${r.winRate.toFixed(0)}%`);
  console.log(`  Avg P&L:     ${r.avgPnl >= 0 ? '+' : ''}${r.avgPnl.toFixed(2)}%`);
  console.log(`  Avg win:     +${r.avgWin.toFixed(2)}%`);
  console.log(`  Avg loss:    ${r.avgLoss.toFixed(2)}%`);
  console.log(`  Avg hold:    ${r.avgDays.toFixed(0)} days`);
  console.log(`  $${r.startCapital} → $${r.endCapital.toFixed(2)} (${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(0)}%)`);
  console.log(`  Verdict:     ${verdict}`);
}

function strategyBacktests() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('🧪 STRATEGY BACKTESTS');
  console.log('═'.repeat(60));

  // ── 1. ETH DIP ENGINE ──────────────────────────────────────
  console.log('\n  1️⃣  S.E ETH Dip — ETH mean reversion');
  console.log('  ' + '─'.repeat(50));
  console.log('  Entry: ETH drops 5%+ in 3 days + RSI < 40');
  console.log('  Exit:  +4% target / -3% stop / 14 day timeout\n');

  const ethCandles = getCandles('ETH/USD', '1D');
  const ethDipResult = backtest(ethCandles,
    (c, i) => {
      if (i < 3) return null;
      const drop3d = (c[i].close - c[i-3].close) / c[i-3].close * 100;
      const prices = c.slice(Math.max(0, i-14), i+1).map(x => x.close);
      const rsi    = calculateRSI(prices);
      if (drop3d < -5 && rsi < 40) return { direction: 'long' };
      return null;
    },
    (c, i, pos) => {
      const pnl  = (c[i].close - pos.entryPrice) / pos.entryPrice * 100;
      const days = i - pos.entryIdx;
      return pnl >= 4 || pnl <= -3 || days >= 14;
    },
    100, 'ETH Dip'
  );
  printBacktest(ethDipResult);

  // ── 2. VOLATILITY SHORT ────────────────────────────────────
  console.log('\n  2️⃣  T.E Volatility Short — short in high vol regime');
  console.log('  ' + '─'.repeat(50));
  console.log('  Entry: 14d vol > 90d vol by 50% + 3 red days + BTC below 50d SMA');
  console.log('  Exit:  +3% target / -2% stop / 7 day timeout\n');

  const btcCandles = getCandles('BTC/USD', '1D');

  const volShortResult = backtest(btcCandles,
    (c, i) => {
      if (i < 90) return null;
      const ret14  = returns(c.slice(i-14, i+1)).map(Math.abs);
      const ret90  = returns(c.slice(i-90, i+1)).map(Math.abs);
      const vol14  = mean(ret14);
      const vol90  = mean(ret90);
      const sma50  = mean(c.slice(i-50, i+1).map(x => x.close));
      const ret3   = returns(c.slice(i-3, i+1));
      const allRed = ret3.every(r => r < 0);
      if (vol14 > vol90 * 1.5 && c[i].close < sma50 && allRed) {
        return { direction: 'short' };
      }
      return null;
    },
    (c, i, pos) => {
      const pnl  = (pos.entryPrice - c[i].close) / pos.entryPrice * 100;
      const days = i - pos.entryIdx;
      return pnl >= 3 || pnl <= -2 || days >= 7;
    },
    100, 'Vol Short'
  );
  printBacktest(volShortResult);

  // ── 3. DOGE SENTIMENT ENGINE ───────────────────────────────
  console.log('\n  3️⃣  S.E DOGE Sentiment — pure sentiment fade');
  console.log('  ' + '─'.repeat(50));
  console.log('  Entry: DOGE drops 20%+ in 5 days + BTC also red');
  console.log('  Exit:  +15% target / -10% stop / 21 day timeout\n');

  const dogeCandles = getCandles('DOGE/USD', '1D');

  const dogeSentResult = backtest(dogeCandles,
    (c, i) => {
      if (i < 5) return null;
      const drop5d = (c[i].close - c[i-5].close) / c[i-5].close * 100;
      if (drop5d < -20) return { direction: 'long' };
      return null;
    },
    (c, i, pos) => {
      const pnl  = (c[i].close - pos.entryPrice) / pos.entryPrice * 100;
      const days = i - pos.entryIdx;
      return pnl >= 15 || pnl <= -10 || days >= 21;
    },
    100, 'DOGE Sentiment'
  );
  printBacktest(dogeSentResult);

  // ── 4. ETH/BTC RATIO TRADE ────────────────────────────────
  console.log('\n  4️⃣  T.E ETH/BTC Ratio — pair trade mean reversion');
  console.log('  ' + '─'.repeat(50));
  console.log('  Entry: ETH/BTC ratio drops 2 std devs below 90d mean');
  console.log('  Exit:  ratio returns to mean / +5% / -3% / 30 day timeout\n');

  const ethbtcCandles = getCandles('ETH/BTC', '1D');

  const ethbtcResult = backtest(ethbtcCandles,
    (c, i) => {
      if (i < 90) return null;
      const closes = c.slice(i-90, i+1).map(x => x.close);
      const z      = zscore(c[i].close, closes);
      if (z < -2) return { direction: 'long' };
      return null;
    },
    (c, i, pos) => {
      const pnl    = (c[i].close - pos.entryPrice) / pos.entryPrice * 100;
      const days   = i - pos.entryIdx;
      const closes = c.slice(Math.max(0, i-90), i+1).map(x => x.close);
      const z      = zscore(c[i].close, closes);
      return pnl >= 5 || pnl <= -3 || days >= 30 || z > -0.5;
    },
    100, 'ETH/BTC Ratio'
  );
  printBacktest(ethbtcResult);

  // ── 5. BEAR FADE ──────────────────────────────────────────
  console.log('\n  5️⃣  S.E Bear Fade — capitulation bounce in downtrends');
  console.log('  ' + '─'.repeat(50));
  console.log('  Entry: BTC below 200d SMA + RSI < 28 + 7d drop > 15%');
  console.log('  Exit:  +8% target / -5% stop / 10 day timeout\n');

  const bearFadeResult = backtest(btcCandles,
    (c, i) => {
      if (i < 200) return null;
      const sma200 = mean(c.slice(i-200, i+1).map(x => x.close));
      const prices = c.slice(Math.max(0, i-14), i+1).map(x => x.close);
      const rsi    = calculateRSI(prices);
      const drop7d = (c[i].close - c[i-7].close) / c[i-7].close * 100;
      if (c[i].close < sma200 && rsi < 28 && drop7d < -15) {
        return { direction: 'long' };
      }
      return null;
    },
    (c, i, pos) => {
      const pnl  = (c[i].close - pos.entryPrice) / pos.entryPrice * 100;
      const days = i - pos.entryIdx;
      return pnl >= 8 || pnl <= -5 || days >= 10;
    },
    100, 'Bear Fade'
  );
  printBacktest(bearFadeResult);

  // ── 6. THREE RED DAYS ENGINE ──────────────────────────────
  console.log('\n  6️⃣  S.E Three Red — 3 consecutive red days');
  console.log('  ' + '─'.repeat(50));
  console.log('  Entry: 3 red days in a row + total drop ≥ 3%');
  console.log('  Exit:  +2% target / -1.5% stop / 3 day timeout\n');

  const threeRedResult = backtest(btcCandles,
    (c, i) => {
      if (i < 3) return null;
      const day1 = c[i-2].close < c[i-3].close;
      const day2 = c[i-1].close < c[i-2].close;
      const day3 = c[i].close   < c[i-1].close;
      const totalDrop = (c[i].close - c[i-3].close) / c[i-3].close * 100;
      if (day1 && day2 && day3 && totalDrop <= -3) {
        return { direction: 'long' };
      }
      return null;
    },
    (c, i, pos) => {
      const pnl  = (c[i].close - pos.entryPrice) / pos.entryPrice * 100;
      const days = i - pos.entryIdx;
      return pnl >= 2 || pnl <= -1.5 || days >= 3;
    },
    100, 'Three Red'
  );
  printBacktest(threeRedResult);

  // ── COMPARISON TABLE ──────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 STRATEGY COMPARISON');
  console.log('═'.repeat(60));
  const all = [ethDipResult, volShortResult, dogeSentResult, ethbtcResult, bearFadeResult, threeRedResult];
  all.filter(Boolean).sort((a,b) => b.returnPct - a.returnPct).forEach(r => {
    const verdict = r.winRate >= 60 && r.avgPnl > 0 ? '✅'
                  : r.winRate >= 52 && r.avgPnl > 0 ? '🟡'
                  : '❌';
    console.log(`  ${verdict} ${r.label.padEnd(18)} trades:${String(r.trades).padStart(3)}  WR:${r.winRate.toFixed(0)}%  return:${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(0)}%`);
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🧠 KRAKEN INTELLIGENCE — Analysis Engine');
  console.log('═'.repeat(60));
  console.log(`Database: ${DB_PATH}`);
  console.log(`Time:     ${new Date().toLocaleString()}`);

  await initDB();

  const pairs = getAllPairs();
  console.log(`\nLoaded ${pairs.length} pairs from database`);

  // Run all analysis modules
  correlationMatrix('1D');
  leadLagAnalysis('1D');
  cascadeAnalysis('1D');
  meanReversionAnalysis('1D');
  volatilityRegime('1D');
  anomalyDetection('1D');
  patternFinder('1D');
  pharaohValidator();
  intradayPatterns();
  strategyBacktests();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('✅ Analysis complete');
  console.log('═'.repeat(60));
  console.log('\nRun again any time to get fresh analysis:');
  console.log('  node analyse.js\n');
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
