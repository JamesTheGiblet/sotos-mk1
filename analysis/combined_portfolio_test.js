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
    if (strat.signalLogic === "consecutive_red") {
      shouldEnter = consecutiveRed >= (strat.requiredRed || 4);
    }
    if (strat.signalLogic === "consecutive_red_or_rsi") {
      let rsiSignal = false;
      if (i >= (strat.rsiPeriod || 21)) {
        const prices = candles.slice(i - (strat.rsiPeriod || 21), i + 1).map(c => c.close);
        const rsi = calculateRSI(prices, strat.rsiPeriod || 21);
        rsiSignal = rsi < (strat.rsiThreshold || 20);
      }
      shouldEnter = consecutiveRed >= (strat.requiredRed || 4) || rsiSignal;
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
        target: entryPrice * (1 + (strat.targetPct || 1) / 100),
        stop: entryPrice * (1 - (strat.stopPct || 0.75) / 100)
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
      else if (holdDays >= (strat.maxHoldDays || 5)) exitReason = "timeout";
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
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;
  return { trades: trades.length, winRate, totalReturn, expectancy, finalCapital: capital, tradesList: trades };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("📊 COMBINED PORTFOLIO FORWARD TEST");
  console.error("=".repeat(70));
  console.error("Transaction costs: 0.3% per trade\n");

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Three approved strategies
  const strategies = [
    { name: "Smart BTC", asset: "BTC/USD", signalLogic: "consecutive_red_or_rsi", targetPct: 5, stopPct: 2.5, maxHoldDays: 14, requiredRed: 4, rsiPeriod: 21, rsiThreshold: 20, entryTiming: "next_open", allocation: 0.4 },
    { name: "4 Red Optimized", asset: "BTC/USD", signalLogic: "consecutive_red", targetPct: 5, stopPct: 2.5, maxHoldDays: 14, requiredRed: 4, entryTiming: "next_open", allocation: 0.3 },
    { name: "4 Red Original", asset: "BTC/USD", signalLogic: "consecutive_red", targetPct: 1, stopPct: 0.75, maxHoldDays: 5, requiredRed: 4, entryTiming: "next_open", allocation: 0.3 }
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
      console.error("No data for " + strat.asset);
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
    const testResult = backtest(testCandles, strat, allocation);
    
    strategyResults.push({
      name: strat.name,
      allocation: strat.allocation * 100,
      ...testResult
    });
    
    allTrades = allTrades.concat(testResult.tradesList);
  }

  // Calculate portfolio totals
  const totalFinalCapital = strategyResults.reduce((sum, r) => sum + r.finalCapital, 0);
  const totalReturn = ((totalFinalCapital - totalCapital) / totalCapital * 100);
  const totalWins = allTrades.filter(t => t.win).length;
  const totalWinRate = allTrades.length ? (totalWins / allTrades.length * 100) : 0;
  const avgExpectancy = strategyResults.reduce((sum, r) => sum + r.expectancy, 0) / strategyResults.length;

  console.error("\n📈 INDIVIDUAL STRATEGY PERFORMANCE (Test Period Only):");
  console.error("-".repeat(70));
  
  for (const r of strategyResults) {
    console.error(`\n${r.name} (${r.allocation}% allocation)`);
    console.error(`   Trades: ${r.trades} | Win Rate: ${r.winRate.toFixed(1)}%`);
    console.error(`   Return: ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% | Expectancy: ${r.expectancy.toFixed(2)}`);
    console.error(`   Final Capital: $${r.finalCapital.toFixed(2)} (start: $${totalCapital * (r.allocation/100)})`);
  }

  console.error("\n" + "=".repeat(70));
  console.error("📊 COMBINED PORTFOLIO RESULTS");
  console.error("=".repeat(70));
  console.error(`\n   Total Capital Invested: $${totalCapital}`);
  console.error(`   Final Portfolio Value: $${totalFinalCapital.toFixed(2)}`);
  console.error(`   Total Return: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%`);
  console.error(`   Total Trades: ${allTrades.length}`);
  console.error(`   Combined Win Rate: ${totalWinRate.toFixed(1)}%`);
  console.error(`   Average Expectancy: ${avgExpectancy.toFixed(2)}`);

  // Find best and worst
  const best = strategyResults.reduce((a, b) => a.totalReturn > b.totalReturn ? a : b);
  const worst = strategyResults.reduce((a, b) => a.totalReturn < b.totalReturn ? a : b);
  
  console.error(`\n   Best Performer: ${best.name} (${best.totalReturn >= 0 ? '+' : ''}${best.totalReturn.toFixed(1)}%)`);
  console.error(`   Worst Performer: ${worst.name} (${worst.totalReturn >= 0 ? '+' : ''}${worst.totalReturn.toFixed(1)}%)`);

  // Recent trades
  console.error("\n" + "=".repeat(70));
  console.error("📋 RECENT PORTFOLIO TRADES (Last 15)");
  console.error("=".repeat(70));
  
  const recentTrades = allTrades.slice(-15).reverse();
  for (const trade of recentTrades) {
    const winSymbol = trade.win ? "✅" : "❌";
    console.error(`   ${winSymbol} P&L: ${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%`);
  }

  console.error("\n" + "=".repeat(70));
  console.error("✅ Combined Portfolio Test Complete");
  console.error("=".repeat(70));
  
  // Recommendation
  console.error("\n💡 RECOMMENDATION:");
  if (totalReturn > 15 && totalWinRate > 60) {
    console.error("   ✅ PORTFOLIO APPROVED — Ready for deployment");
    console.error(`   Expected return: +${totalReturn.toFixed(1)}% on $${totalCapital}`);
  } else if (totalReturn > 0) {
    console.error("   🟡 MARGINAL — Consider adjusting allocations");
  } else {
    console.error("   ❌ REJECTED — Portfolio does not have positive expectancy");
  }
}

main().catch(console.error);
