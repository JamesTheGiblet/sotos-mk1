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

function backtestStrategy(candles, strat, startCapital) {
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

  const totalReturn = ((capital - startCapital) / startCapital * 100);
  return { totalReturn, trades: trades.length };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("📊 OPTIMIZING PORTFOLIO ALLOCATION");
  console.error("=".repeat(70));
  console.error("Finding optimal capital distribution across 4 strategies\n");

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Define the four approved strategies
  const strategies = [
    { 
      name: "Smart BTC (Opt)", 
      asset: "BTC/USD", 
      type: "consecutive_or_rsi", 
      params: { count: 4, rsiPeriod: 30, rsiThreshold: 30 },
      targetPct: 8, 
      stopPct: 2, 
      maxHoldDays: 10, 
      entryTiming: "close"
    },
    { 
      name: "LINK Optimized", 
      asset: "LINK/USD", 
      type: "consecutive", 
      params: { count: 4 },
      targetPct: 5, 
      stopPct: 0.5, 
      maxHoldDays: 3, 
      entryTiming: "close"
    },
    { 
      name: "4 Red Original", 
      asset: "BTC/USD", 
      type: "consecutive", 
      params: { count: 4 },
      targetPct: 1, 
      stopPct: 0.75, 
      maxHoldDays: 5, 
      entryTiming: "next_open"
    },
    { 
      name: "4 Red Optimized", 
      asset: "BTC/USD", 
      type: "consecutive", 
      params: { count: 4 },
      targetPct: 5, 
      stopPct: 2.5, 
      maxHoldDays: 14, 
      entryTiming: "next_open"
    }
  ];

  // Get test period returns for each strategy
  const results = [];
  
  for (const strat of strategies) {
    const result = db.exec(
      "SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC",
      [strat.asset, "1D"]
    );
    
    if (!result.length) {
      console.error(`No data for ${strat.asset}`);
      return;
    }
    
    const { columns, values } = result[0];
    const candles = values.map(row => {
      const c = {};
      columns.forEach((col, i) => c[col] = row[i]);
      return c;
    });
    
    // Use test period (last 20% of data)
    const splitIdx = Math.floor(candles.length * 0.8);
    const testCandles = candles.slice(splitIdx);
    
    const testResult = backtestStrategy(testCandles, strat, 100);
    
    results.push({
      name: strat.name,
      return: testResult.totalReturn,
      trades: testResult.trades
    });
  }

  console.error("\n📈 INDIVIDUAL STRATEGY RETURNS (Test Period):");
  console.error("-".repeat(50));
  for (const r of results) {
    console.error(`   ${r.name.padEnd(20)}: +${r.return.toFixed(1)}% (${r.trades} trades)`);
  }

  // Optimize allocations using grid search
  const totalCapital = 1000;
  const allocations = [];
  
  // Test allocation combinations (steps of 5%)
  for (let a = 0; a <= 100; a += 5) {
    for (let b = 0; b <= 100 - a; b += 5) {
      for (let c = 0; c <= 100 - a - b; c += 5) {
        const d = 100 - a - b - c;
        if (d < 0) continue;
        
        const alloc = [a, b, c, d];
        
        // Calculate portfolio return
        let portfolioReturn = 0;
        for (let i = 0; i < results.length; i++) {
          portfolioReturn += results[i].return * (alloc[i] / 100);
        }
        
        allocations.push({
          alloc: { 
            smart_btc: alloc[0], 
            link: alloc[1], 
            four_red_original: alloc[2], 
            four_red_optimized: alloc[3] 
          },
          return: portfolioReturn
        });
      }
    }
  }
  
  // Sort by return
  allocations.sort((a, b) => b.return - a.return);
  
  console.error("\n🏆 TOP 10 ALLOCATION STRATEGIES:");
  console.error("=".repeat(70));
  
  for (let i = 0; i < Math.min(10, allocations.length); i++) {
    const a = allocations[i];
    console.error(`\n${i+1}. Return: +${a.return.toFixed(1)}%`);
    console.error(`   Smart BTC: ${a.alloc.smart_btc}% | LINK: ${a.alloc.link}% | 4 Red Original: ${a.alloc.four_red_original}% | 4 Red Optimized: ${a.alloc.four_red_optimized}%`);
  }
  
  // Best allocation
  const best = allocations[0];
  const worst = allocations[allocations.length - 1];
  
  console.error("\n" + "=".repeat(70));
  console.error("🎯 OPTIMAL ALLOCATION:");
  console.error("=".repeat(70));
  console.error(`\n   Smart BTC (Opt):     ${best.alloc.smart_btc}%`);
  console.error(`   LINK Optimized:      ${best.alloc.link}%`);
  console.error(`   4 Red Original:      ${best.alloc.four_red_original}%`);
  console.error(`   4 Red Optimized:     ${best.alloc.four_red_optimized}%`);
  console.error(`\n   Expected Return:     +${best.return.toFixed(1)}% on $${totalCapital}`);
  
  // Compare to equal allocation
  const equalReturn = (results[0].return * 0.25 + results[1].return * 0.25 + results[2].return * 0.25 + results[3].return * 0.25);
  console.error(`\n   Equal Allocation (25% each): +${equalReturn.toFixed(1)}%`);
  console.error(`   Improvement: +${(best.return - equalReturn).toFixed(1)}%`);
  
  // Recommended portfolio
  console.error("\n" + "=".repeat(70));
  console.error("📋 RECOMMENDED PORTFOLIO");
  console.error("=".repeat(70));
  console.error(`\n   Total Capital: $${totalCapital}`);
  console.error(`   Smart BTC (Opt):     $${totalCapital * best.alloc.smart_btc / 100}`);
  console.error(`   LINK Optimized:      $${totalCapital * best.alloc.link / 100}`);
  console.error(`   4 Red Original:      $${totalCapital * best.alloc.four_red_original / 100}`);
  console.error(`   4 Red Optimized:     $${totalCapital * best.alloc.four_red_optimized / 100}`);
  console.error(`\n   Expected Return: +${best.return.toFixed(1)}% → $${(totalCapital * (1 + best.return / 100)).toFixed(2)}`);
  
  // Save results
  const outputPath = path.join(__dirname, '../strategies/optimal_allocation.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    optimal: best.alloc,
    expectedReturn: best.return,
    allTop10: allocations.slice(0, 10)
  }, null, 2));
  console.error(`\n✅ Saved to ${outputPath}`);
}

main().catch(console.error);
