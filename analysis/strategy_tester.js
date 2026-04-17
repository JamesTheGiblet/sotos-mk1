#!/usr/bin/env node
'use strict';

/**
 * COMPREHENSIVE STRATEGY TESTER
 * Test any combination of validated strategies with variable parameters
 * 
 * Usage:
 *   node strategy_tester.js --strategy all --capital 500 --days 30
 *   node strategy_tester.js --strategy four_red --asset BTC --target 2 --stop 1.5
 *   node strategy_tester.js --strategy three_asset --allocations "BTC:0.4,ETH:0.3,SOL:0.3"
 *   node strategy_tester.js --compare
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

// ============================================================
// VALIDATED STRATEGY DEFINITIONS
// ============================================================

const STRATEGIES = {
  // 1. Four Red Days (Original)
  four_red: {
    name: 'Four Red Days',
    description: '4 consecutive red days → buy at next open',
    assets: ['BTC/USD'],
    defaultParams: {
      targetPct: 1,
      stopPct: 0.75,
      maxHoldDays: 5,
      requiredRed: 4,
      entryTiming: 'next_open'
    },
    paramRanges: {
      targetPct: [0.5, 1, 1.5, 2, 2.5, 3, 4, 5],
      stopPct: [0.3, 0.5, 0.75, 1, 1.5, 2, 2.5],
      maxHoldDays: [2, 3, 5, 7, 10, 14],
      requiredRed: [2, 3, 4, 5]
    }
  },

  // 2. Smart BTC (4-red OR RSI<20)
  smart_btc: {
    name: 'Smart BTC',
    description: '4 red days OR RSI(21) < 20 → buy at next open',
    assets: ['BTC/USD'],
    defaultParams: {
      targetPct: 5,
      stopPct: 2.5,
      maxHoldDays: 14,
      requiredRed: 4,
      rsiPeriod: 21,
      rsiThreshold: 20,
      entryTiming: 'next_open'
    },
    paramRanges: {
      targetPct: [2, 3, 4, 5, 6],
      stopPct: [1, 1.5, 2, 2.5, 3],
      maxHoldDays: [7, 10, 14, 21],
      rsiThreshold: [15, 20, 25, 30]
    }
  },

  // 3. Three Asset Portfolio
  three_asset: {
    name: 'Three Asset Portfolio',
    description: '4 red days on LINK/BTC/LTC with 40/40/20 allocation',
    assets: ['LINK/USD', 'BTC/USD', 'LTC/USD'],
    defaultParams: {
      targetPct: 1,
      stopPct: 0.75,
      maxHoldDays: 5,
      requiredRed: 4,
      entryTiming: 'next_open',
      allocations: { 'LINK/USD': 0.4, 'BTC/USD': 0.4, 'LTC/USD': 0.2 }
    },
    paramRanges: {
      targetPct: [0.5, 1, 1.5, 2],
      stopPct: [0.5, 0.75, 1, 1.5],
      maxHoldDays: [3, 5, 7, 10]
    }
  },

  // 4. RSI Oversold (XRP/ETH)
  rsi_oversold: {
    name: 'RSI Oversold',
    description: 'RSI(14) < threshold → buy at next open',
    assets: ['XRP/USD', 'ETH/USD'],
    defaultParams: {
      targetPct: 5,
      stopPct: 1.5,
      maxHoldDays: 7,
      rsiPeriod: 14,
      rsiThreshold: 25,
      entryTiming: 'next_open'
    },
    paramRanges: {
      targetPct: [3, 4, 5, 6, 7],
      stopPct: [1, 1.5, 2, 2.5],
      maxHoldDays: [5, 7, 10, 14],
      rsiThreshold: [20, 25, 30, 35]
    }
  },

  // 5. Consecutive Red (Multi-asset)
  consecutive_red: {
    name: 'Consecutive Red',
    description: 'N consecutive red days → buy',
    assets: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD'],
    defaultParams: {
      targetPct: 1,
      stopPct: 0.75,
      maxHoldDays: 5,
      requiredRed: 4,
      entryTiming: 'next_open'
    },
    paramRanges: {
      targetPct: [0.5, 1, 1.5, 2, 2.5, 3],
      stopPct: [0.3, 0.5, 0.75, 1, 1.5],
      maxHoldDays: [2, 3, 5, 7, 10],
      requiredRed: [2, 3, 4, 5]
    }
  },

  // 6. Combined (Best of all)
  combined: {
    name: 'Combined Portfolio',
    description: 'Run all validated strategies in parallel',
    assets: ['BTC/USD', 'ETH/USD', 'XRP/USD', 'LINK/USD', 'LTC/USD'],
    defaultParams: {
      strategies: ['four_red', 'smart_btc', 'three_asset', 'rsi_oversold'],
      capitalPerStrategy: 100
    }
  }
};

// ============================================================
// BACKTEST ENGINE
// ============================================================

const COSTS = { entry: 0.0015, exit: 0.0015 };

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

function backtestStrategy(candles, strategy, params) {
  let capital = 100;
  let position = null;
  let trades = [];
  let consecutiveRed = 0;
  
  const targetPct = params.targetPct;
  const stopPct = params.stopPct;
  const maxHoldDays = params.maxHoldDays;
  const requiredRed = params.requiredRed || 4;
  const entryTiming = params.entryTiming || 'next_open';
  const rsiPeriod = params.rsiPeriod || 14;
  const rsiThreshold = params.rsiThreshold || 25;
  
  for (let i = 30; i < candles.length; i++) {
    const candle = candles[i];
    
    // Update consecutive red counter
    if (candle.close < candle.open) {
      consecutiveRed++;
    } else {
      consecutiveRed = 0;
    }
    
    // Check entry conditions
    let shouldEnter = false;
    let signalType = '';
    
    if (strategy === 'four_red' || strategy === 'three_asset' || strategy === 'consecutive_red') {
      shouldEnter = consecutiveRed >= requiredRed;
      signalType = 'consecutive_red';
    }
    
    if (strategy === 'smart_btc') {
      // RSI condition
      let rsiSignal = false;
      if (i >= rsiPeriod) {
        const prices = candles.slice(i - rsiPeriod, i + 1).map(c => c.close);
        const rsi = calculateRSI(prices, rsiPeriod);
        rsiSignal = rsi < rsiThreshold;
      }
      shouldEnter = consecutiveRed >= requiredRed || rsiSignal;
      signalType = shouldEnter ? (consecutiveRed >= requiredRed ? 'consecutive_red' : 'rsi_oversold') : '';
    }
    
    if (strategy === 'rsi_oversold') {
      if (i >= rsiPeriod) {
        const prices = candles.slice(i - rsiPeriod, i + 1).map(c => c.close);
        const rsi = calculateRSI(prices, rsiPeriod);
        shouldEnter = rsi < rsiThreshold;
        signalType = 'rsi_oversold';
      }
    }
    
    // Entry
    if (!position && shouldEnter) {
      let entryPrice = candle.close;
      let entryTimestamp = candle.timestamp;
      
      if (entryTiming === 'next_open' && i + 1 < candles.length) {
        entryPrice = candles[i + 1].open;
        entryTimestamp = candles[i + 1].timestamp;
      } else if (entryTiming === 'next_close' && i + 1 < candles.length) {
        entryPrice = candles[i + 1].close;
        entryTimestamp = candles[i + 1].timestamp;
      }
      
      const entryCost = capital * COSTS.entry;
      capital -= entryCost;
      
      position = {
        entryPrice,
        entryTimestamp,
        size: capital,
        target: entryPrice * (1 + targetPct / 100),
        stop: entryPrice * (1 - stopPct / 100),
        signalType,
        entryIndex: i
      };
      continue;
    }
    
    // Exit
    if (position) {
      const price = candle.close;
      const pnlPct = (price - position.entryPrice) / position.entryPrice * 100;
      const holdDays = Math.floor((candle.timestamp - position.entryTimestamp) / 86400);
      
      let exitReason = null;
      if (price >= position.target) exitReason = 'take_profit';
      else if (price <= position.stop) exitReason = 'stop_loss';
      else if (holdDays >= maxHoldDays) exitReason = 'timeout';
      
      if (exitReason) {
        const grossPnl = position.size * (pnlPct / 100);
        const exitCost = position.size * COSTS.exit;
        const netPnl = grossPnl - exitCost;
        const netPnlPct = (netPnl / position.size) * 100;
        
        capital += netPnl;
        
        trades.push({
          signalType: position.signalType,
          entryPrice: position.entryPrice,
          exitPrice: price,
          pnlPct: netPnlPct,
          pnl: netPnl,
          win: netPnl > 0,
          reason: exitReason,
          holdDays,
          entryDate: new Date(position.entryTimestamp * 1000).toISOString().split('T')[0]
        });
        
        position = null;
        consecutiveRed = 0;
      }
    }
  }
  
  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;
  const totalReturn = ((capital - 100) / 100 * 100);
  const avgWin = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / (wins || 1);
  const avgLoss = trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) / ((trades.length - wins) || 1);
  const expectancy = (winRate / 100 * avgWin) - ((1 - winRate / 100) * Math.abs(avgLoss));
  
  return {
    trades: trades.length,
    wins,
    winRate: winRate.toFixed(1),
    totalReturn: totalReturn.toFixed(1),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    expectancy: expectancy.toFixed(3),
    finalCapital: capital,
    tradesList: trades.slice(-20)
  };
}

async function runBacktest(strategyName, customParams = {}) {
  const strategy = STRATEGIES[strategyName];
  if (!strategy) {
    console.error(`Unknown strategy: ${strategyName}`);
    return null;
  }
  
  const params = { ...strategy.defaultParams, ...customParams };
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 ${strategy.name}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`Description: ${strategy.description}`);
  console.log(`Parameters: ${JSON.stringify(params, null, 2)}`);
  
  const results = [];
  
  for (const asset of strategy.assets) {
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = '1D'
       ORDER BY timestamp ASC`,
      [asset]
    );
    
    if (result.length) {
      const { columns, values } = result[0];
      const candles = values.map(row => {
        const c = {};
        columns.forEach((col, i) => c[col] = row[i]);
        return c;
      });
      
      const backtest = backtestStrategy(candles, strategyName, params);
      results.push({ asset, ...backtest });
    }
  }
  
  db.close();
  
  // Display results
  console.log(`\nResults:`);
  console.log('-'.repeat(50));
  
  for (const r of results) {
    const verdict = r.winRate >= 60 ? '✅' : (r.winRate >= 55 ? '🟡' : '❌');
    console.log(`${verdict} ${r.asset}`);
    console.log(`   Trades: ${r.trades} | WR: ${r.winRate}% | Return: ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn}%`);
    console.log(`   Expectancy: ${r.expectancy} | Capital: $${r.finalCapital.toFixed(2)}`);
  }
  
  // Portfolio total if multiple assets
  if (results.length > 1) {
    const totalCapital = results.reduce((sum, r) => sum + r.finalCapital, 0);
    const totalReturn = ((totalCapital - 100 * results.length) / (100 * results.length) * 100);
    console.log(`\n📈 PORTFOLIO TOTAL: $${totalCapital.toFixed(2)} (${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%)`);
  }
  
  return results;
}

async function runOptimization(strategyName) {
  const strategy = STRATEGIES[strategyName];
  if (!strategy) {
    console.error(`Unknown strategy: ${strategyName}`);
    return;
  }
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🔧 OPTIMIZING: ${strategy.name}`);
  console.log(`${'═'.repeat(70)}`);
  
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);
  
  // Get candles for first asset
  const asset = strategy.assets[0];
  const result = db.exec(
    `SELECT timestamp, open, high, low, close, volume
     FROM candles
     WHERE pair = ? AND interval = '1D'
     ORDER BY timestamp ASC`,
    [asset]
  );
  
  if (!result.length) {
    console.error(`No data for ${asset}`);
    return;
  }
  
  const { columns, values } = result[0];
  const candles = values.map(row => {
    const c = {};
    columns.forEach((col, i) => c[col] = row[i]);
    return c;
  });
  
  db.close();
  
  // Grid search
  const results = [];
  const paramRanges = strategy.paramRanges;
  const paramNames = Object.keys(paramRanges);
  
  function search(depth, currentParams) {
    if (depth === paramNames.length) {
      const backtest = backtestStrategy(candles, strategyName, currentParams);
      results.push({ params: { ...currentParams }, result: backtest });
      return;
    }
    
    const paramName = paramNames[depth];
    for (const value of paramRanges[paramName]) {
      search(depth + 1, { ...currentParams, [paramName]: value });
    }
  }
  
  search(0, { ...strategy.defaultParams });
  
  // Sort by expectancy
  results.sort((a, b) => parseFloat(b.result.expectancy) - parseFloat(a.result.expectancy));
  
  console.log(`\n🏆 TOP 10 PARAMETER COMBINATIONS (by expectancy):`);
  console.log('-'.repeat(80));
  
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(`\n${i+1}. Expectancy: ${r.result.expectancy} | WR: ${r.result.winRate}% | Return: ${r.result.totalReturn}%`);
    console.log(`   Params: ${JSON.stringify(r.params)}`);
  }
  
  return results;
}

async function compareStrategies() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 STRATEGY COMPARISON`);
  console.log(`${'═'.repeat(70)}`);
  
  const strategiesToTest = ['four_red', 'smart_btc', 'three_asset', 'rsi_oversold'];
  const allResults = [];
  
  for (const stratName of strategiesToTest) {
    const results = await runBacktest(stratName, {});
    if (results && results.length) {
      const totalCapital = results.reduce((sum, r) => sum + r.finalCapital, 0);
      const totalReturn = ((totalCapital - 100 * results.length) / (100 * results.length) * 100);
      allResults.push({
        name: STRATEGIES[stratName].name,
        trades: results.reduce((sum, r) => sum + r.trades, 0),
        winRate: results.reduce((sum, r) => sum + parseFloat(r.winRate), 0) / results.length,
        return: totalReturn,
        capital: totalCapital
      });
    }
  }
  
  console.log(`\n📈 COMPARISON SUMMARY:`);
  console.log('-'.repeat(70));
  console.log(`  Strategy              | Trades | Win Rate | Return | Capital`);
  console.log('-'.repeat(70));
  
  allResults.sort((a, b) => b.return - a.return);
  for (const r of allResults) {
    const verdict = r.winRate >= 60 ? '✅' : (r.winRate >= 55 ? '🟡' : '❌');
    console.log(`  ${verdict} ${r.name.padEnd(20)} | ${String(r.trades).padStart(4)}   | ${r.winRate.toFixed(1)}%    | ${r.return >= 0 ? '+' : ''}${r.return.toFixed(1)}%  | $${r.capital.toFixed(0)}`);
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === 'help') {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    STRATEGY TESTER — Usage                                     ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║  Test a strategy:                                                              ║
║    node strategy_tester.js --strategy four_red                                ║
║    node strategy_tester.js --strategy smart_btc --target 4 --stop 2           ║
║                                                                                ║
║  Optimize parameters:                                                          ║
║    node strategy_tester.js --optimize four_red                                ║
║                                                                                ║
║  Compare all strategies:                                                       ║
║    node strategy_tester.js --compare                                           ║
║                                                                                ║
║  Available strategies:                                                         ║
║    four_red        - 4 consecutive red days                                    ║
║    smart_btc       - 4-red OR RSI<20                                           ║
║    three_asset     - LINK/BTC/LTC 40/40/20                                     ║
║    rsi_oversold    - RSI(14) < threshold                                       ║
║    consecutive_red - N red days on any asset                                   ║
║    combined        - All strategies together                                   ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
    return;
  }
  
  if (args.includes('--compare')) {
    await compareStrategies();
  } else if (args.includes('--optimize')) {
    const idx = args.indexOf('--optimize');
    const strategyName = args[idx + 1];
    if (strategyName && STRATEGIES[strategyName]) {
      await runOptimization(strategyName);
    } else {
      console.error(`Please specify a valid strategy to optimize. Options: ${Object.keys(STRATEGIES).join(', ')}`);
    }
  } else if (args.includes('--strategy')) {
    const idx = args.indexOf('--strategy');
    const strategyName = args[idx + 1];
    
    // Parse custom parameters
    const customParams = {};
    for (let i = 2; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        const param = args[i].slice(2);
        const value = args[i + 1];
        if (!isNaN(parseFloat(value))) {
          customParams[param] = parseFloat(value);
        } else {
          customParams[param] = value;
        }
      }
    }
    
    if (strategyName && STRATEGIES[strategyName]) {
      await runBacktest(strategyName, customParams);
    } else {
      console.error(`Unknown strategy: ${strategyName}`);
      console.log(`Available: ${Object.keys(STRATEGIES).join(', ')}`);
    }
  }
}

main().catch(console.error);
