#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

async function forwardSimulation() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🔬 Forward Simulation — f2i1vk (90% WR strategy)');
  console.log('════════════════════════════════════════════════════════════\n');
  console.log('Strategy: Consecutive red (2 days) + Z-score < -1.5');
  console.log('Exit: +1% target / -0.5% stop / 14 day timeout\n');

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get all BTC/USD daily candles
  const result = db.exec(
    `SELECT timestamp, open, high, low, close, volume
     FROM candles
     WHERE pair = 'BTC/USD' AND interval = '1D'
     ORDER BY timestamp ASC`
  );

  db.close();

  if (!result.length) {
    console.error('No data found');
    return;
  }

  const { columns, values } = result[0];
  const candles = values.map(row => {
    const candle = {};
    columns.forEach((col, i) => candle[col] = row[i]);
    return candle;
  });

  // Split data: 80% backtest, 20% forward test
  const splitIdx = Math.floor(candles.length * 0.8);
  const backtestCandles = candles.slice(0, splitIdx);
  const forwardCandles = candles.slice(splitIdx);

  console.log(`Total candles: ${candles.length}`);
  console.log(`Backtest period: ${backtestCandles.length} candles (${new Date(backtestCandles[0].timestamp * 1000).toISOString().split('T')[0]} to ${new Date(backtestCandles[backtestCandles.length-1].timestamp * 1000).toISOString().split('T')[0]})`);
  console.log(`Forward period:  ${forwardCandles.length} candles (${new Date(forwardCandles[0].timestamp * 1000).toISOString().split('T')[0]} to ${new Date(forwardCandles[forwardCandles.length-1].timestamp * 1000).toISOString().split('T')[0]})\n`);

  // Helper functions
  function zscore(value, arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return (value - mean) / std;
  }

  function backtest(candles, label) {
    let capital = 100;
    let position = null;
    let trades = [];
    let consecutiveRed = 0;

    for (let i = 30; i < candles.length; i++) {
      // Track consecutive red
      if (candles[i].close < candles[i].open) {
        consecutiveRed++;
      } else {
        consecutiveRed = 0;
      }

      if (!position && consecutiveRed >= 2) {
        // Check Z-score condition
        const prices = candles.slice(i - 30, i + 1).map(c => c.close);
        const z = zscore(candles[i].close, prices);
        
        if (z < -1.5) {
          position = {
            entryPrice: candles[i].close,
            entryIdx: i,
            entryDate: candles[i].timestamp
          };
        }
      } else if (position) {
        const pnlPct = (candles[i].close - position.entryPrice) / position.entryPrice * 100;
        const holdDays = Math.floor((candles[i].timestamp - position.entryDate) / 86400);
        
        let exit = false;
        let reason = '';
        
        if (pnlPct >= 1) {
          exit = true;
          reason = 'take_profit';
        } else if (pnlPct <= -0.5) {
          exit = true;
          reason = 'stop_loss';
        } else if (holdDays >= 14) {
          exit = true;
          reason = 'timeout';
        }
        
        if (exit) {
          const pnl = capital * (pnlPct / 100);
          capital += pnl;
          trades.push({
            pnlPct,
            pnl,
            win: pnl > 0,
            reason,
            holdDays
          });
          position = null;
        }
      }
    }

    const wins = trades.filter(t => t.win).length;
    const winRate = trades.length ? (wins / trades.length * 100) : 0;
    const totalReturn = ((capital - 100) / 100 * 100);
    
    console.log(`\n📊 ${label}:`);
    console.log(`   Trades:      ${trades.length}`);
    console.log(`   Win rate:    ${winRate.toFixed(1)}%`);
    console.log(`   Total return: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%`);
    console.log(`   Final capital: $${capital.toFixed(2)}`);
    
    if (trades.length > 0) {
      const avgWin = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / wins;
      const avgLoss = trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) / (trades.length - wins);
      console.log(`   Avg win:     +${avgWin.toFixed(2)}%`);
      console.log(`   Avg loss:    ${avgLoss.toFixed(2)}%`);
      
      // Show recent trades
      console.log(`\n   Recent trades:`);
      trades.slice(-5).reverse().forEach(t => {
        console.log(`     ${t.reason.padEnd(12)} ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%  hold:${t.holdDays}d`);
      });
    }
    
    return { trades, winRate, totalReturn, capital };
  }

  // Run backtest on historical period
  const backtestResult = backtest(backtestCandles, 'BACKTEST (80% of data)');
  
  // Run forward simulation on unseen data
  const forwardResult = backtest(forwardCandles, 'FORWARD SIMULATION (20% unseen)');
  
  console.log('\n' + '═'.repeat(60));
  console.log('📈 VERDICT');
  console.log('═'.repeat(60));
  
  const degradation = backtestResult.winRate - forwardResult.winRate;
  
  if (forwardResult.winRate >= 70 && forwardResult.totalReturn > 0) {
    console.log('\n✅ STRATEGY VALIDATED — Forward simulation confirms edge');
    console.log(`   Forward win rate: ${forwardResult.winRate.toFixed(1)}%`);
    console.log(`   Forward return: +${forwardResult.totalReturn.toFixed(1)}%`);
  } else if (forwardResult.winRate >= 60 && forwardResult.totalReturn > 0) {
    console.log('\n🟡 MARGINAL EDGE — Degradation detected but still positive');
    console.log(`   Win rate drop: ${degradation.toFixed(1)}% (${backtestResult.winRate.toFixed(1)}% → ${forwardResult.winRate.toFixed(1)}%)`);
  } else {
    console.log('\n❌ STRATEGY FAILED — Edge does not hold out-of-sample');
    console.log(`   Win rate drop: ${degradation.toFixed(1)}% (${backtestResult.winRate.toFixed(1)}% → ${forwardResult.winRate.toFixed(1)}%)`);
  }
  
  console.log(`\nRecommendation: ${forwardResult.winRate >= 70 ? 'Deploy with confidence' : forwardResult.winRate >= 60 ? 'Proceed with caution, use dry run first' : 'Do not deploy — revisit strategy'}`);
}

forwardSimulation().catch(console.error);
