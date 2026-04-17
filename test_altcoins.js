#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

// 4-red-day strategy parameters
const STRATEGY = {
  requiredRed: 4,
  targetPct: 1,
  stopPct: 0.75,
  maxHoldDays: 5
};

// Altcoins to test
const ALTCOINS = [
  'XRP/USD',
  'LTC/USD', 
  'ADA/USD',
  'LINK/USD',
  'SOL/USD',  // Retest with 4-red-day (not change+consecutive)
  'DOGE/USD'  // Already have as baseline
];

function backtest(candles) {
  let capital = 100;
  let position = null;
  let trades = [];
  let consecutiveRed = 0;

  for (let i = 30; i < candles.length; i++) {
    // Track consecutive red days
    if (candles[i].close < candles[i].open) {
      consecutiveRed++;
    } else {
      consecutiveRed = 0;
    }

    // Entry
    if (!position && consecutiveRed >= STRATEGY.requiredRed) {
      position = {
        entryPrice: candles[i].close,
        entryIdx: i,
        entryDate: candles[i].timestamp
      };
    } 
    // Exit
    else if (position) {
      const pnlPct = (candles[i].close - position.entryPrice) / position.entryPrice * 100;
      const holdDays = Math.floor((candles[i].timestamp - position.entryDate) / 86400);
      
      let exit = false;
      let reason = '';
      
      if (pnlPct >= STRATEGY.targetPct) {
        exit = true;
        reason = 'take_profit';
      } else if (pnlPct <= -STRATEGY.stopPct) {
        exit = true;
        reason = 'stop_loss';
      } else if (holdDays >= STRATEGY.maxHoldDays) {
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
        consecutiveRed = 0;
      }
    }
  }

  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;
  const totalReturn = ((capital - 100) / 100 * 100);
  const avgWin = wins ? trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / wins : 0;
  const avgLoss = (trades.length - wins) ? trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) / (trades.length - wins) : 0;
  const avgHold = trades.length ? trades.reduce((s, t) => s + t.holdDays, 0) / trades.length : 0;

  return {
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate,
    totalReturn,
    avgWin,
    avgLoss,
    avgHold,
    finalCapital: capital
  };
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 ALTCOIN TEST — 4 Red Days Strategy');
  console.log('═'.repeat(60));
  console.log(`Entry: ${STRATEGY.requiredRed} consecutive red days`);
  console.log(`Exit: +${STRATEGY.targetPct}% / -${STRATEGY.stopPct}% / ${STRATEGY.maxHoldDays}d timeout\n`);

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  const results = [];

  for (const altcoin of ALTCOINS) {
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = '1D'
       ORDER BY timestamp ASC`,
      [altcoin]
    );

    if (result.length) {
      const { columns, values } = result[0];
      const candles = values.map(row => {
        const candle = {};
        columns.forEach((col, i) => candle[col] = row[i]);
        return candle;
      });
      
      const backtestResult = backtest(candles);
      results.push({
        asset: altcoin,
        ...backtestResult,
        candles: candles.length
      });
    } else {
      console.log(`${altcoin}: No data found`);
    }
  }

  db.close();

  // Sort by win rate
  results.sort((a, b) => b.winRate - a.winRate);

  console.log('\n📈 Results (sorted by win rate):');
  console.log('─'.repeat(85));
  console.log(`  Asset       | Trades | Wins | Losses | WR%   | Return | Avg Win | Avg Loss | Hold`);
  console.log('─'.repeat(85));
  
  for (const r of results) {
    console.log(`  ${r.asset.padEnd(10)} | ${String(r.trades).padStart(4)}   | ${String(r.wins).padStart(3)}   | ${String(r.losses).padStart(4)}   | ${r.winRate.toFixed(0)}%   | ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% | +${r.avgWin.toFixed(2)}%  | ${r.avgLoss.toFixed(2)}%  | ${r.avgHold.toFixed(0)}d`);
  }

  console.log('─'.repeat(85));
  
  // Add BTC baseline for reference
  console.log(`\n📌 BTC baseline (4 red days): 77% WR, +65.6% return, 26 trades\n`);
  
  // Recommendation
  console.log('💡 Recommendations:');
  for (const r of results) {
    if (r.winRate >= 70 && r.totalReturn > 20) {
      console.log(`  ✅ ${r.asset} — Strong candidate (${r.winRate.toFixed(0)}% WR, +${r.totalReturn.toFixed(0)}% return)`);
    } else if (r.winRate >= 60 && r.totalReturn > 10) {
      console.log(`  🟡 ${r.asset} — Moderate candidate (${r.winRate.toFixed(0)}% WR, +${r.totalReturn.toFixed(0)}% return)`);
    } else if (r.totalReturn < 0) {
      console.log(`  ❌ ${r.asset} — Not recommended (${r.winRate.toFixed(0)}% WR, ${r.totalReturn.toFixed(0)}% return)`);
    }
  }
}

main().catch(console.error);
