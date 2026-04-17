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
    if (strat.type === 'consecutive_or_rsi') {
      let rsiSignal = false;
      if (i >= strat.params.rsiPeriod) {
        const prices = candles.slice(i - strat.params.rsiPeriod, i + 1).map(c => c.close);
        const rsi = calculateRSI(prices, strat.params.rsiPeriod);
        rsiSignal = rsi < strat.params.rsiThreshold;
      }
      shouldEnter = consecutiveRed >= strat.params.count || rsiSignal;
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
  return { trades: trades.length, winRate, totalReturn, expectancy, finalCapital: capital, tradesList: trades };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("📊 FORWARD PORTFOLIO TEST — BTC + LINK");
  console.error("=".repeat(70));
  console.error("Transaction costs: 0.3% per trade\n");

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Approved strategies
  const strategies = [
    { 
      name: "LINK Optimized", 
      asset: "LINK/USD", 
      type: "consecutive", 
      params: { count: 4 },
      targetPct: 5, 
      stopPct: 0.5, 
      maxHoldDays: 3, 
      entryTiming: "close",
      allocation: 0.3
    },
    { 
      name: "Smart BTC", 
      asset: "BTC/USD", 
      type: "consecutive_or_rsi", 
      params: { count: 4, rsiPeriod: 21, rsiThreshold: 20 },
      targetPct: 5, 
      stopPct: 2.5, 
      maxHoldDays: 14, 
      entryTiming: "next_open",
      allocation: 0.3
    },
    { 
      name: "4 Red Optimized", 
      asset: "BTC/USD", 
      type: "consecutive", 
      params: { count: 4 },
      targetPct: 5, 
      stopPct: 2.5, 
      maxHoldDays: 14, 
      entryTiming: "next_open",
      allocation: 0.2
    },
    { 
      name: "4 Red Original", 
      asset: "BTC/USD", 
      type: "consecutive", 
      params: { count: 4 },
      targetPct: 1, 
      stopPct: 0.75, 
      maxHoldDays: 5, 
      entryTiming: "next_open",
      allocation: 0.2
    }
  ];

  const totalCapital = 1000;
  let portfolioCapital = totalCapital;
  let allTrades = [];
  let strategyResults = [];

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
    
    const allocation = totalCapital * strat.allocation;
    const trainResult = backtest(trainCandles, strat, allocation);
    const testResult = backtest(testCandles, strat, allocation);
    
    strategyResults.push({
      name: strat.name,
      allocation: strat.allocation * 100,
      train: trainResult,
      test: testResult
    });
    
    allTrades = allTrades.concat(testResult.tradesList);
  }

  // Calculate portfolio totals
  const totalFinalCapital = strategyResults.reduce((sum, r) => sum + r.test.finalCapital, 0);
  const totalReturn = ((totalFinalCapital - totalCapital) / totalCapital * 100);
  const totalWins = allTrades.filter(t => t.win).length;
  const totalWinRate = allTrades.length ? (totalWins / allTrades.length * 100) : 0;

  console.error("\n📈 INDIVIDUAL STRATEGY PERFORMANCE (Test Period):");
  console.error("-".repeat(70));
  
  for (const r of strategyResults) {
    const verdict = r.test.winRate >= 55 && r.test.totalReturn > 0 ? "✅" : (r.test.totalReturn > 0 ? "🟡" : "❌");
    console.error(`\n${verdict} ${r.name} (${r.allocation}% allocation)`);
    console.error(`   TRAIN: ${r.train.trades} trades | ${r.train.winRate.toFixed(1)}% WR | +${r.train.totalReturn.toFixed(1)}% | E:${r.train.expectancy.toFixed(2)}`);
    console.error(`   TEST:  ${r.test.trades} trades | ${r.test.winRate.toFixed(1)}% WR | ${r.test.totalReturn >= 0 ? "+" : ""}${r.test.totalReturn.toFixed(1)}% | E:${r.test.expectancy.toFixed(2)}`);
  }

  console.error("\n" + "=".repeat(70));
  console.error("📊 COMBINED PORTFOLIO RESULTS");
  console.error("=".repeat(70));
  console.error(`\n   Total Capital: $${totalCapital}`);
  console.error(`   Final Value: $${totalFinalCapital.toFixed(2)}`);
  console.error(`   Total Return: ${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`);
  console.error(`   Total Trades: ${allTrades.length}`);
  console.error(`   Combined Win Rate: ${totalWinRate.toFixed(1)}%`);

  // Best and worst
  const best = strategyResults.reduce((a, b) => a.test.totalReturn > b.test.totalReturn ? a : b);
  const worst = strategyResults.reduce((a, b) => a.test.totalReturn < b.test.totalReturn ? a : b);
  
  console.error(`\n   Best Performer: ${best.name} (${best.test.totalReturn >= 0 ? "+" : ""}${best.test.totalReturn.toFixed(1)}%)`);
  console.error(`   Worst Performer: ${worst.name} (${worst.test.totalReturn >= 0 ? "+" : ""}${worst.test.totalReturn.toFixed(1)}%)`);

  // Recommendation
  console.error("\n" + "=".repeat(70));
  console.error("💡 RECOMMENDATION");
  console.error("=".repeat(70));
  
  if (totalReturn > 15 && totalWinRate > 60) {
    console.error(`\n   ✅ PORTFOLIO APPROVED`);
    console.error(`   Expected return: +${totalReturn.toFixed(1)}% on $${totalCapital}`);
    console.error(`   Expected win rate: ${totalWinRate.toFixed(0)}%`);
  } else if (totalReturn > 0) {
    console.error(`\n   🟡 MARGINAL — Consider adjusting allocations`);
  } else {
    console.error(`\n   ❌ REJECTED — Portfolio does not have positive expectancy`);
  }
  
  console.error("\n" + "=".repeat(70));
  console.error("Forward portfolio test complete");
  console.error("=".repeat(70));
}

main().catch(console.error);
