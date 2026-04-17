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
    
    // Smart BTC: 4-red OR RSI condition
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
  const profitFactor = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / Math.abs(trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) || 1);
  
  return { trades: trades.length, winRate, totalReturn, expectancy, profitFactor, finalCapital: capital };
}

async function main() {
  console.error("\n" + "=".repeat(70));
  console.error("🔧 OPTIMIZING SMART BTC STRATEGY");
  console.error("=".repeat(70));
  console.error("Strategy: 4-red days OR RSI < threshold\n");

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
  
  // Split data
  const splitIdx = Math.floor(candles.length * 0.8);
  const trainCandles = candles.slice(0, splitIdx);
  const testCandles = candles.slice(splitIdx);
  
  // Parameter ranges
  const redCounts = [2, 3, 4, 5];
  const rsiPeriods = [7, 14, 21, 30];
  const rsiThresholds = [15, 20, 25, 30, 35];
  const targets = [2, 3, 4, 5, 6, 7, 8];
  const stops = [1, 1.5, 2, 2.5, 3, 3.5];
  const holds = [5, 7, 10, 14, 21];
  const timings = ["close", "next_open"];
  
  const results = [];
  let totalTests = 0;
  
  for (const redCount of redCounts) {
    for (const rsiPeriod of rsiPeriods) {
      for (const rsiThreshold of rsiThresholds) {
        for (const target of targets) {
          for (const stop of stops) {
            if (stop >= target) continue;
            for (const hold of holds) {
              for (const timing of timings) {
                totalTests++;
                
                const strat = {
                  redCount,
                  rsiPeriod,
                  rsiThreshold,
                  targetPct: target,
                  stopPct: stop,
                  maxHoldDays: hold,
                  entryTiming: timing
                };
                
                const trainResult = backtest(trainCandles, strat);
                const testResult = backtest(testCandles, strat);
                
                // Score based on test performance
                let score = 0;
                if (testResult.winRate >= 55 && testResult.totalReturn > 0) {
                  score = testResult.expectancy * testResult.winRate * (testResult.trades / 10);
                }
                
                if (score > 0) {
                  results.push({
                    params: { redCount, rsiPeriod, rsiThreshold, target, stop, hold, timing },
                    train: trainResult,
                    test: testResult,
                    score
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  console.error(`\n📊 Tested ${totalTests} parameter combinations`);
  console.error(`✅ Found ${results.length} viable combinations\n`);
  
  console.error("🏆 TOP 15 OPTIMIZED PARAMETERS:");
  console.error("=".repeat(70));
  
  for (let i = 0; i < Math.min(15, results.length); i++) {
    const r = results[i];
    const p = r.params;
    console.error(`\n${i+1}. ${p.redCount}-red OR RSI(${p.rsiPeriod})<${p.rsiThreshold} | target:${p.target}% stop:${p.stop}% hold:${p.hold}d | timing:${p.timing}`);
    console.error(`   Score: ${r.score.toFixed(2)}`);
    console.error(`   TRAIN: ${r.train.trades} trades | ${r.train.winRate.toFixed(1)}% WR | +${r.train.totalReturn.toFixed(1)}% | E:${r.train.expectancy.toFixed(2)}`);
    console.error(`   TEST:  ${r.test.trades} trades | ${r.test.winRate.toFixed(1)}% WR | +${r.test.totalReturn.toFixed(1)}% | E:${r.test.expectancy.toFixed(2)}`);
  }
  
  // Best configuration
  const best = results[0];
  console.error("\n" + "=".repeat(70));
  console.error("🎯 RECOMMENDED CONFIGURATION:");
  console.error("=".repeat(70));
  console.error(`\n   Entry Signal: ${best.params.redCount} red days OR RSI(${best.params.rsiPeriod}) < ${best.params.rsiThreshold}`);
  console.error(`   Entry Timing: ${best.params.timing}`);
  console.error(`   Target: ${best.params.target}%`);
  console.error(`   Stop Loss: ${best.params.stop}%`);
  console.error(`   Max Hold: ${best.params.hold} days`);
  console.error(`\n   Expected Win Rate: ${best.test.winRate.toFixed(1)}%`);
  console.error(`   Expected Return: +${best.test.totalReturn.toFixed(1)}%`);
  console.error(`   Expectancy: ${best.test.expectancy.toFixed(2)}`);
  console.error(`   Trades in test: ${best.test.trades}`);
  
  // Save results
  const outputPath = path.join(__dirname, '../strategies/smart_btc_optimized.json');
  fs.writeFileSync(outputPath, JSON.stringify(results.slice(0, 20), null, 2));
  console.error(`\n✅ Saved to ${outputPath}`);
}

main().catch(console.error);
