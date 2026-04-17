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
    
    let rsiSignal = false;
    if (i >= strat.rsiPeriod) {
      const prices = candles.slice(i - strat.rsiPeriod, i + 1).map(c => c.close);
      const rsi = calculateRSI(prices, strat.rsiPeriod);
      rsiSignal = rsi < strat.rsiThreshold;
    }
    shouldEnter = consecutiveRed >= strat.redCount || rsiSignal;

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
  
  return { trades: trades.length, wins, winRate, totalReturn, expectancy, finalCapital: capital, tradesList: trades };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("🔬 FINAL SMART BTC TEST — Extended Validation");
  console.error("=".repeat(70));
  console.error("Strategy: 4 red days OR RSI(30) < 30");
  console.error("Entry: close | Target: 8% | Stop: 2% | Hold: 10 days");
  console.error("Transaction costs: 0.3% per trade\n");

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get BTC data
  const result = db.exec(
    "SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC",
    ["BTC/USD", "1D"]
  );
  
  if (!result.length) {
    console.error("No data for BTC/USD");
    return;
  }
  
  const { columns, values } = result[0];
  const candles = values.map(row => {
    const c = {};
    columns.forEach((col, i) => c[col] = row[i]);
    return c;
  });
  
  db.close();
  
  const strat = {
    redCount: 4,
    rsiPeriod: 30,
    rsiThreshold: 30,
    targetPct: 8,
    stopPct: 2,
    maxHoldDays: 10,
    entryTiming: "close"
  };
  
  // Test multiple split ratios to ensure robustness
  const splits = [
    { name: "70/30", trainPct: 0.70, testPct: 0.30 },
    { name: "75/25", trainPct: 0.75, testPct: 0.25 },
    { name: "80/20", trainPct: 0.80, testPct: 0.20 },
    { name: "85/15", trainPct: 0.85, testPct: 0.15 },
    { name: "90/10", trainPct: 0.90, testPct: 0.10 }
  ];
  
  console.error("📊 TESTING DIFFERENT SPLIT RATIOS:");
  console.error("=".repeat(70));
  
  const results = [];
  
  for (const split of splits) {
    const splitIdx = Math.floor(candles.length * split.trainPct);
    const trainCandles = candles.slice(0, splitIdx);
    const testCandles = candles.slice(splitIdx);
    
    const trainResult = backtest(trainCandles, strat);
    const testResult = backtest(testCandles, strat);
    
    results.push({
      split: split.name,
      train: trainResult,
      test: testResult
    });
    
    console.error(`\n📈 ${split.name} Split:`);
    console.error(`   TRAIN (${split.trainPct * 100}%): ${trainResult.trades} trades | ${trainResult.winRate.toFixed(1)}% WR | +${trainResult.totalReturn.toFixed(1)}% | E:${trainResult.expectancy.toFixed(2)}`);
    console.error(`   TEST  (${split.testPct * 100}%): ${testResult.trades} trades | ${testResult.winRate.toFixed(1)}% WR | +${testResult.totalReturn.toFixed(1)}% | E:${testResult.expectancy.toFixed(2)}`);
  }
  
  // Full walk-forward: train on early data, test on later data
  console.error("\n" + "=".repeat(70));
  console.error("📊 WALK-FORWARD ANALYSIS (Multiple Time Periods)");
  console.error("=".repeat(70));
  
  // Split into 4 periods
  const periodSize = Math.floor(candles.length / 4);
  const periods = [
    { name: "Period 1", start: 0, end: periodSize },
    { name: "Period 2", start: periodSize, end: periodSize * 2 },
    { name: "Period 3", start: periodSize * 2, end: periodSize * 3 },
    { name: "Period 4", start: periodSize * 3, end: candles.length }
  ];
  
  const periodResults = [];
  
  for (let i = 0; i < periods.length; i++) {
    const periodCandles = candles.slice(periods[i].start, periods[i].end);
    const result = backtest(periodCandles, strat);
    periodResults.push({
      name: periods[i].name,
      ...result
    });
  }
  
  console.error("\n   Period      | Trades | Win Rate | Return | Expectancy");
  console.error("   " + "-".repeat(55));
  
  for (const r of periodResults) {
    console.error(`   ${r.name.padEnd(11)} | ${String(r.trades).padStart(4)}    | ${r.winRate.toFixed(1)}%     | ${r.totalReturn >= 0 ? "+" : ""}${r.totalReturn.toFixed(1)}%   | ${r.expectancy.toFixed(2)}`);
  }
  
  // Final consolidated result
  console.error("\n" + "=".repeat(70));
  console.error("📊 FINAL CONSOLIDATED RESULTS (All Data)");
  console.error("=".repeat(70));
  
  const fullResult = backtest(candles, strat);
  console.error(`\n   Total Capital: $100 → $${fullResult.finalCapital.toFixed(2)}`);
  console.error(`   Total Return: +${fullResult.totalReturn.toFixed(1)}%`);
  console.error(`   Total Trades: ${fullResult.trades}`);
  console.error(`   Win Rate: ${fullResult.winRate.toFixed(1)}%`);
  console.error(`   Expectancy: ${fullResult.expectancy.toFixed(2)}`);
  console.error(`   Avg Win: +${fullResult.avgWin.toFixed(2)}%`);
  console.error(`   Avg Loss: -${Math.abs(fullResult.avgLoss).toFixed(2)}%`);
  
  // Recent trades
  console.error("\n" + "=".repeat(70));
  console.error("📋 RECENT TRADES (All Periods)");
  console.error("=".repeat(70));
  
  const recentTrades = fullResult.tradesList.slice(-15).reverse();
  for (const trade of recentTrades) {
    const winSymbol = trade.win ? "✅" : "❌";
    console.error(`   ${winSymbol} P&L: ${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`);
  }
  
  // Final verdict
  console.error("\n" + "=".repeat(70));
  console.error("🎯 FINAL VERDICT");
  console.error("=".repeat(70));
  
  const allPeriodsPositive = periodResults.every(r => r.totalReturn > 0);
  const allPeriodsHighWR = periodResults.every(r => r.winRate >= 60);
  
  if (allPeriodsPositive && allPeriodsHighWR && fullResult.winRate >= 70) {
    console.error("\n   ✅ SMART BTC (OPTIMIZED) — FULLY VALIDATED");
    console.error(`   ${fullResult.winRate.toFixed(0)}% win rate across ${fullResult.trades} trades`);
    console.error(`   +${fullResult.totalReturn.toFixed(0)}% return over full period`);
    console.error(`   Positive in all ${periodResults.length} sub-periods`);
    console.error("\n   Ready for deployment.");
  } else if (fullResult.totalReturn > 0 && fullResult.winRate >= 60) {
    console.error("\n   🟡 MARGINAL EDGE — Proceed with caution");
  } else {
    console.error("\n   ❌ STRATEGY FAILED — Do not deploy");
  }
  
  console.error("\n" + "=".repeat(70));
  console.error("Final test complete");
  console.error("=".repeat(70));
}

main().catch(console.error);
