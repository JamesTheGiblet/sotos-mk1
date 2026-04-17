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
    
    // RSI condition
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
  
  return { trades: trades.length, winRate, totalReturn, expectancy, finalCapital: capital, tradesList: trades };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("🔬 FORWARD TEST — Optimized Smart BTC");
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
  
  // Split data: 80% train, 20% test
  const splitIdx = Math.floor(candles.length * 0.8);
  const trainCandles = candles.slice(0, splitIdx);
  const testCandles = candles.slice(splitIdx);
  
  const trainStart = new Date(trainCandles[0].timestamp * 1000).toISOString().split('T')[0];
  const trainEnd = new Date(trainCandles[trainCandles.length-1].timestamp * 1000).toISOString().split('T')[0];
  const testStart = new Date(testCandles[0].timestamp * 1000).toISOString().split('T')[0];
  const testEnd = new Date(testCandles[testCandles.length-1].timestamp * 1000).toISOString().split('T')[0];
  
  // Original strategy (for comparison)
  const originalStrat = {
    redCount: 4,
    rsiPeriod: 21,
    rsiThreshold: 20,
    targetPct: 5,
    stopPct: 2.5,
    maxHoldDays: 14,
    entryTiming: "next_open"
  };
  
  // Optimized strategy
  const optimizedStrat = {
    redCount: 4,
    rsiPeriod: 30,
    rsiThreshold: 30,
    targetPct: 8,
    stopPct: 2,
    maxHoldDays: 10,
    entryTiming: "close"
  };
  
  const originalTrain = backtest(trainCandles, originalStrat);
  const originalTest = backtest(testCandles, originalStrat);
  
  const optimizedTrain = backtest(trainCandles, optimizedStrat);
  const optimizedTest = backtest(testCandles, optimizedStrat);
  
  console.error("📊 COMPARISON: Original vs Optimized");
  console.error("=".repeat(70));
  
  console.error("\n🔵 ORIGINAL STRATEGY:");
  console.error(`   Signal: 4-red OR RSI(21)<20 | Target:5% Stop:2.5% Hold:14d | Timing:next_open`);
  console.error(`   TRAIN (${trainStart} → ${trainEnd}): ${originalTrain.trades} trades | ${originalTrain.winRate.toFixed(1)}% WR | +${originalTrain.totalReturn.toFixed(1)}% | E:${originalTrain.expectancy.toFixed(2)}`);
  console.error(`   TEST  (${testStart} → ${testEnd}): ${originalTest.trades} trades | ${originalTest.winRate.toFixed(1)}% WR | +${originalTest.totalReturn.toFixed(1)}% | E:${originalTest.expectancy.toFixed(2)}`);
  
  console.error("\n🟢 OPTIMIZED STRATEGY:");
  console.error(`   Signal: 4-red OR RSI(30)<30 | Target:8% Stop:2% Hold:10d | Timing:close`);
  console.error(`   TRAIN (${trainStart} → ${trainEnd}): ${optimizedTrain.trades} trades | ${optimizedTrain.winRate.toFixed(1)}% WR | +${optimizedTrain.totalReturn.toFixed(1)}% | E:${optimizedTrain.expectancy.toFixed(2)}`);
  console.error(`   TEST  (${testStart} → ${testEnd}): ${optimizedTest.trades} trades | ${optimizedTest.winRate.toFixed(1)}% WR | +${optimizedTest.totalReturn.toFixed(1)}% | E:${optimizedTest.expectancy.toFixed(2)}`);
  
  // Improvement
  const wrImprovement = optimizedTest.winRate - originalTest.winRate;
  const returnImprovement = optimizedTest.totalReturn - originalTest.totalReturn;
  const expImprovement = optimizedTest.expectancy - originalTest.expectancy;
  
  console.error("\n📈 IMPROVEMENT:");
  console.error(`   Win Rate: +${wrImprovement.toFixed(1)}% (${originalTest.winRate.toFixed(1)}% → ${optimizedTest.winRate.toFixed(1)}%)`);
  console.error(`   Return: +${returnImprovement.toFixed(1)}% (${originalTest.totalReturn.toFixed(1)}% → ${optimizedTest.totalReturn.toFixed(1)}%)`);
  console.error(`   Expectancy: +${expImprovement.toFixed(2)} (${originalTest.expectancy.toFixed(2)} → ${optimizedTest.expectancy.toFixed(2)})`);
  
  // Recent trades
  console.error("\n" + "=".repeat(70));
  console.error("📋 OPTIMIZED STRATEGY — RECENT TRADES (Test Period)");
  console.error("=".repeat(70));
  
  for (const trade of optimizedTest.tradesList.slice(-10).reverse()) {
    const winSymbol = trade.win ? "✅" : "❌";
    console.error(`   ${winSymbol} P&L: ${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`);
  }
  
  // Verdict
  console.error("\n" + "=".repeat(70));
  console.error("🎯 VERDICT");
  console.error("=".repeat(70));
  
  if (optimizedTest.winRate >= 70 && optimizedTest.totalReturn > 30) {
    console.error("\n   ✅ OPTIMIZED STRATEGY APPROVED");
    console.error(`   Ready for deployment with ${optimizedTest.winRate.toFixed(0)}% WR and +${optimizedTest.totalReturn.toFixed(0)}% return`);
  } else if (optimizedTest.totalReturn > 0) {
    console.error("\n   🟡 MARGINAL — Consider further optimization");
  } else {
    console.error("\n   ❌ REJECTED — Strategy does not have positive edge");
  }
  
  console.error("\n" + "=".repeat(70));
  console.error("Forward test complete");
  console.error("=".repeat(70));
}

main().catch(console.error);
