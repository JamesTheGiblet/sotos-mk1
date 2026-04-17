#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const COSTS = { entry: 0.0015, exit: 0.0015 };

function calculateRSI(prices, period) {
  period = period || 14;
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

function backtest(candles, strat, startCapital) {
  startCapital = startCapital || 100;
  let capital = startCapital;
  let position = null;
  let trades = [];
  let consecutiveRed = 0;

  for (let i = 30; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.close < candle.open) consecutiveRed++;
    else consecutiveRed = 0;

    let shouldEnter = false;

    if (strat.type === 'consecutive') {
      shouldEnter = consecutiveRed >= strat.params.count;
    }
    if (strat.type === 'zscore') {
      if (i >= strat.params.period) {
        const prices = candles.slice(i - strat.params.period, i + 1).map(c => c.close);
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
        const std = Math.sqrt(variance);
        const z = (candle.close - mean) / std;
        shouldEnter = z < strat.params.threshold;
      }
    }
    if (strat.type === 'rsi') {
      if (i >= strat.params.period) {
        const prices = candles.slice(i - strat.params.period, i + 1).map(c => c.close);
        const rsi = calculateRSI(prices, strat.params.period);
        shouldEnter = rsi < strat.params.threshold;
      }
    }
    if (strat.type === 'zscore_and_consecutive') {
      let zscoreSignal = false;
      if (i >= strat.params.zscorePeriod) {
        const prices = candles.slice(i - strat.params.zscorePeriod, i + 1).map(c => c.close);
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
        const std = Math.sqrt(variance);
        const z = (candle.close - mean) / std;
        zscoreSignal = z < strat.params.zscoreThreshold;
      }
      shouldEnter = zscoreSignal && consecutiveRed >= strat.params.count;
    }

    if (!position && shouldEnter) {
      let entryPrice = candle.close;
      if (strat.entryTiming === "next_open" && i + 1 < candles.length) {
        entryPrice = candles[i + 1].open;
      }
      const entryCost = capital * COSTS.entry;
      capital -= entryCost;
      position = {
        entryPrice: entryPrice,
        entryTimestamp: candle.timestamp,
        size: capital,
        target: entryPrice * (1 + strat.targetPct / 100),
        stop: entryPrice * (1 - strat.stopPct / 100)
      };
      continue;
    }

    if (position) {
      const price = candle.close;
      const pnlPct = (price - position.entryPrice) / position.entryPrice * 100;
      const holdDays = Math.floor((candle.timestamp - position.entryTimestamp) / 86400);
      let exitReason = null;
      if (price >= position.target) exitReason = "take_profit";
      else if (price <= position.stop) exitReason = "stop_loss";
      else if (holdDays >= strat.maxHoldDays) exitReason = "timeout";
      if (exitReason) {
        const grossPnl = position.size * (pnlPct / 100);
        const exitCost = position.size * COSTS.exit;
        const netPnl = grossPnl - exitCost;
        capital += netPnl;
        trades.push({ win: netPnl > 0, pnlPct: (netPnl / position.size) * 100 });
        position = null;
        consecutiveRed = 0;
      }
    }
  }

  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;
  const totalReturn = ((capital - startCapital) / startCapital * 100);
  const avgWin = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / (wins || 1);
  const avgLoss = trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) / ((trades.length - wins) || 1);
  const expectancy = (winRate / 100 * avgWin) - ((1 - winRate / 100) * Math.abs(avgLoss));
  return { trades: trades.length, winRate, totalReturn, expectancy, finalCapital: capital };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("🔬 FORWARD VALIDATION — SOL, LINK, ADA");
  console.error("=".repeat(70));
  console.error("Transaction costs: 0.3% per trade\n");

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Top strategies from discovery
  const strategies = [
    // SOL
    { name: "SOL: Z-score + 2 red", asset: "SOL/USD", type: "zscore_and_consecutive", params: { zscorePeriod: 30, zscoreThreshold: -1, count: 2 }, targetPct: 1, stopPct: 0.75, maxHoldDays: 3, entryTiming: "next_open" },
    { name: "SOL: RSI < 35", asset: "SOL/USD", type: "rsi", params: { period: 14, threshold: 35 }, targetPct: 2, stopPct: 1.5, maxHoldDays: 3, entryTiming: "next_open" },
    { name: "SOL: Z-score < -1.5", asset: "SOL/USD", type: "zscore", params: { period: 60, threshold: -1.5 }, targetPct: 2, stopPct: 1.5, maxHoldDays: 10, entryTiming: "next_open" },
    // LINK
    { name: "LINK: Z-score < -1", asset: "LINK/USD", type: "zscore", params: { period: 30, threshold: -1 }, targetPct: 2, stopPct: 1.5, maxHoldDays: 5, entryTiming: "next_open" },
    { name: "LINK: RSI < 35", asset: "LINK/USD", type: "rsi", params: { period: 14, threshold: 35 }, targetPct: 2, stopPct: 1.5, maxHoldDays: 7, entryTiming: "next_open" },
    { name: "LINK: 3 red days", asset: "LINK/USD", type: "consecutive", params: { count: 3 }, targetPct: 3, stopPct: 2.5, maxHoldDays: 5, entryTiming: "next_open" },
    // ADA
    { name: "ADA: 3 red days", asset: "ADA/USD", type: "consecutive", params: { count: 3 }, targetPct: 3, stopPct: 2.25, maxHoldDays: 3, entryTiming: "next_open" },
    { name: "ADA: Volatility + Z-score", asset: "ADA/USD", type: "zscore", params: { period: 30, threshold: -1 }, targetPct: 4, stopPct: 2.5, maxHoldDays: 3, entryTiming: "next_open" },
    { name: "ADA: Z-score < -1.5", asset: "ADA/USD", type: "zscore", params: { period: 30, threshold: -1.5 }, targetPct: 1, stopPct: 0.75, maxHoldDays: 2, entryTiming: "next_open" }
  ];

  const results = [];

  for (const strat of strategies) {
    const result = db.exec(
      "SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC",
      [strat.asset, "1D"]
    );
    if (!result.length) {
      console.error(`No data for ${strat.asset}`);
      continue;
    }
    const { columns, values } = result[0];
    const candles = values.map(row => {
      const c = {};
      columns.forEach((col, i) => c[col] = row[i]);
      return c;
    });
    
    const splitIdx = Math.floor(candles.length * 0.8);
    const trainCandles = candles.slice(0, splitIdx);
    const testCandles = candles.slice(splitIdx);
    
    const trainResult = backtest(trainCandles, strat);
    const testResult = backtest(testCandles, strat);
    
    results.push({
      name: strat.name,
      asset: strat.asset,
      train: trainResult,
      test: testResult,
      degradation: trainResult.winRate - testResult.winRate
    });
  }

  console.error("\n📊 FORWARD VALIDATION RESULTS:");
  console.error("=".repeat(70));
  
  for (const r of results) {
    const verdict = (r.test.winRate >= 55 && r.test.totalReturn > 0) ? "✅ PASS" : (r.test.totalReturn > 0 ? "🟡 MARGINAL" : "❌ FAIL");
    console.error(`\n${verdict} ${r.name}`);
    console.error(`   TRAIN: ${r.train.trades} trades | ${r.train.winRate.toFixed(1)}% WR | +${r.train.totalReturn.toFixed(1)}% | E:${r.train.expectancy.toFixed(2)}`);
    console.error(`   TEST:  ${r.test.trades} trades | ${r.test.winRate.toFixed(1)}% WR | ${r.test.totalReturn >= 0 ? "+" : ""}${r.test.totalReturn.toFixed(1)}% | E:${r.test.expectancy.toFixed(2)}`);
    console.error(`   Degradation: ${r.degradation.toFixed(1)}%`);
  }

  // Summary
  console.error("\n" + "=".repeat(70));
  console.error("📈 SUMMARY");
  console.error("=".repeat(70));
  
  const passing = results.filter(r => r.test.winRate >= 55 && r.test.totalReturn > 0);
  const failing = results.filter(r => r.test.totalReturn <= 0);
  
  console.error(`\n✅ PASSING: ${passing.length}`);
  passing.forEach(r => console.error(`   - ${r.name} (${r.test.winRate.toFixed(0)}% WR, +${r.test.totalReturn.toFixed(0)}% return)`));
  
  if (failing.length) {
    console.error(`\n❌ FAILING: ${failing.length}`);
    failing.forEach(r => console.error(`   - ${r.name} (${r.test.winRate.toFixed(0)}% WR, ${r.test.totalReturn.toFixed(0)}% return)`));
  }
  
  console.error("\n" + "=".repeat(70));
  console.error("Forward validation complete");
  console.error("=".repeat(70));
}

main().catch(console.error);
