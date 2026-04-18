#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

// Portfolio configuration
const PORTFOLIO = {
  assets: {
    'LINK/USD': 0.30,
    'BTC/USD': 0.30,
    'LTC/USD': 0.20,
    'XRP/USD': 0.20
  },
  strategy: {
    requiredRed: 4,
    targetPct: 1,
    stopPct: 0.75,
    maxHoldDays: 5
  },
  initialCapital: 250
};

function backtest(candles, strategy, initialCapital = 100) {
  let capital = initialCapital;
  let position = null;
  let trades = [];
  let consecutiveRed = 0;

  for (let i = 30; i < candles.length; i++) {
    if (candles[i].close < candles[i].open) {
      consecutiveRed++;
    } else {
      consecutiveRed = 0;
    }

    if (!position && consecutiveRed >= strategy.requiredRed) {
      position = {
        entryPrice: candles[i].close,
        entryDate: candles[i].timestamp
      };
    } 
    else if (position) {
      const pnlPct = (candles[i].close - position.entryPrice) / position.entryPrice * 100;
      const holdDays = Math.floor((candles[i].timestamp - position.entryDate) / 86400);
      
      let exit = false;
      let reason = '';
      
      if (pnlPct >= strategy.targetPct) {
        exit = true;
        reason = 'take_profit';
      } else if (pnlPct <= -strategy.stopPct) {
        exit = true;
        reason = 'stop_loss';
      } else if (holdDays >= strategy.maxHoldDays) {
        exit = true;
        reason = 'timeout';
      }
      
      if (exit) {
        const pnl = capital * (pnlPct / 100);
        capital += pnl;
        trades.push({ pnlPct, pnl, win: pnl > 0, reason, holdDays });
        position = null;
        consecutiveRed = 0;
      }
    }
  }

  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;
  const totalReturn = ((capital - initialCapital) / initialCapital * 100);

  return { trades: trades.length, wins, winRate, totalReturn, finalCapital: capital };
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🔬 PORTFOLIO FORWARD SIMULATION — 4 Red Days');
  console.log('═'.repeat(60));
  console.log(`Entry: ${PORTFOLIO.strategy.requiredRed} consecutive red days`);
  console.log(`Exit: +${PORTFOLIO.strategy.targetPct}% / -${PORTFOLIO.strategy.stopPct}% / ${PORTFOLIO.strategy.maxHoldDays}d timeout`);
  console.log(`Initial Capital: $${PORTFOLIO.initialCapital}\n`);

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get candles for each asset and find the minimum length
  const assetsData = {};
  let minLength = Infinity;

  for (const [asset, weight] of Object.entries(PORTFOLIO.assets)) {
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
        const candle = {};
        columns.forEach((col, i) => candle[col] = row[i]);
        return candle;
      });
      assetsData[asset] = { candles, weight };
      if (candles.length < minLength) minLength = candles.length;
    }
  }

  db.close();

  // Split point: 80% backtest, 20% forward
  const splitIdx = Math.floor(minLength * 0.8);
  
  console.log(`Data split: ${splitIdx} candles backtest, ${minLength - splitIdx} candles forward\n`);

  // Run backtest on training period
  console.log('─'.repeat(60));
  console.log('📊 BACKTEST (80% of data)');
  console.log('─'.repeat(60));

  let backtestTotalCapital = 0;
  const backtestResults = [];

  for (const [asset, data] of Object.entries(assetsData)) {
    const trainCandles = data.candles.slice(0, splitIdx);
    const assetCapital = PORTFOLIO.initialCapital * data.weight;
    const result = backtest(trainCandles, PORTFOLIO.strategy, assetCapital);
    backtestTotalCapital += result.finalCapital;
    backtestResults.push({ asset, weight: data.weight * 100, ...result });
  }

  for (const r of backtestResults) {
    console.log(`  ${r.asset.padEnd(10)} | ${String(r.trades).padStart(3)} trades | ${r.winRate.toFixed(0)}% WR | ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% return`);
  }

  const backtestTotalReturn = ((backtestTotalCapital - PORTFOLIO.initialCapital) / PORTFOLIO.initialCapital * 100);
  console.log(`\n  Portfolio Return: +${backtestTotalReturn.toFixed(1)}% ($${backtestTotalCapital.toFixed(2)})`);

  // Run forward simulation on test period
  console.log('\n' + '─'.repeat(60));
  console.log('🔮 FORWARD SIMULATION (20% unseen data)');
  console.log('─'.repeat(60));

  let forwardTotalCapital = 0;
  const forwardResults = [];

  for (const [asset, data] of Object.entries(assetsData)) {
    const testCandles = data.candles.slice(splitIdx);
    const assetCapital = PORTFOLIO.initialCapital * data.weight;
    const result = backtest(testCandles, PORTFOLIO.strategy, assetCapital);
    forwardTotalCapital += result.finalCapital;
    forwardResults.push({ asset, weight: data.weight * 100, ...result });
  }

  for (const r of forwardResults) {
    console.log(`  ${r.asset.padEnd(10)} | ${String(r.trades).padStart(3)} trades | ${r.winRate.toFixed(0)}% WR | ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% return`);
  }

  const forwardTotalReturn = ((forwardTotalCapital - PORTFOLIO.initialCapital) / PORTFOLIO.initialCapital * 100);
  console.log(`\n  Portfolio Return: +${forwardTotalReturn.toFixed(1)}% ($${forwardTotalCapital.toFixed(2)})`);

  // Comparison
  console.log('\n' + '═'.repeat(60));
  console.log('📈 COMPARISON: Backtest vs Forward');
  console.log('═'.repeat(60));
  
  const returnDiff = forwardTotalReturn - backtestTotalReturn;
  const winRateDiff = (forwardResults.reduce((s, r) => s + (r.winRate * r.weight / 100), 0)) - 
                      (backtestResults.reduce((s, r) => s + (r.winRate * r.weight / 100), 0));
  
  console.log(`\n  Metric          | Backtest | Forward | Difference`);
  console.log('  ' + '─'.repeat(50));
  console.log(`  Portfolio Return | +${backtestTotalReturn.toFixed(1)}%     | +${forwardTotalReturn.toFixed(1)}%     | ${returnDiff >= 0 ? '+' : ''}${returnDiff.toFixed(1)}%`);
  console.log(`  Portfolio WR     | ${backtestResults.reduce((s, r) => s + (r.winRate * r.weight / 100), 0).toFixed(1)}%     | ${forwardResults.reduce((s, r) => s + (r.winRate * r.weight / 100), 0).toFixed(1)}%     | ${winRateDiff >= 0 ? '+' : ''}${winRateDiff.toFixed(1)}%`);

  // Verdict
  console.log('\n' + '═'.repeat(60));
  console.log('🎯 VERDICT');
  console.log('═'.repeat(60));
  
  if (forwardTotalReturn > 10 && forwardTotalReturn > backtestTotalReturn * 0.5) {
    console.log('\n✅ PORTFOLIO VALIDATED — Forward simulation confirms edge');
    console.log(`   Forward return: +${forwardTotalReturn.toFixed(1)}%`);
    console.log(`   Ready for dry run deployment`);
  } else if (forwardTotalReturn > 0) {
    console.log('\n🟡 MARGINAL EDGE — Positive but degraded');
    console.log(`   Forward return: +${forwardTotalReturn.toFixed(1)}% (vs backtest +${backtestTotalReturn.toFixed(1)}%)`);
    console.log(`   Recommend extended dry run`);
  } else {
    console.log('\n❌ PORTFOLIO FAILED — Edge does not hold out-of-sample');
    console.log(`   Forward return: ${forwardTotalReturn.toFixed(1)}%`);
    console.log(`   Do not deploy — revisit strategy`);
  }
  
  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
