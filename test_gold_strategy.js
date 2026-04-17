#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

const STRATEGY = {
  requiredRed: 4,
  targetPct: 0.5,  // Gold is less volatile
  stopPct: 0.4,
  maxHoldDays: 5
};

function backtest(candles) {
  let capital = 100;
  let position = null;
  let trades = [];
  let consecutiveRed = 0;

  for (let i = 30; i < candles.length; i++) {
    if (candles[i].close < candles[i].open) {
      consecutiveRed++;
    } else {
      consecutiveRed = 0;
    }

    if (!position && consecutiveRed >= STRATEGY.requiredRed) {
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
        trades.push({ pnlPct, pnl, win: pnl > 0, reason, holdDays });
        position = null;
        consecutiveRed = 0;
      }
    }
  }

  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;
  const totalReturn = ((capital - 100) / 100 * 100);

  return { trades: trades.length, wins, winRate, totalReturn, finalCapital: capital };
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🥇 GOLD — 4 Red Days Strategy Test');
  console.log('═'.repeat(60));
  console.log(`Entry: ${STRATEGY.requiredRed} consecutive red days`);
  console.log(`Exit: +${STRATEGY.targetPct}% / -${STRATEGY.stopPct}% / ${STRATEGY.maxHoldDays}d timeout\n`);

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Directly query for the gold pairs we know were collected
  const goldPairs = ['XAUTUSD', 'PAXGUSD', 'XAUTUSDT'];
  
  for (const pair of goldPairs) {
    const result = db.exec(
      `SELECT timestamp, open, high, low, close, volume
       FROM candles
       WHERE pair = ? AND interval = '1D'
       ORDER BY timestamp ASC`,
      [pair]
    );

    if (result.length && result[0].values.length > 0) {
      const { columns, values } = result[0];
      const candles = values.map(row => {
        const candle = {};
        columns.forEach((col, i) => candle[col] = row[i]);
        return candle;
      });
      
      const testResult = backtest(candles);
      console.log(`${pair}:`);
      console.log(`  Candles: ${candles.length}`);
      console.log(`  Trades: ${testResult.trades}`);
      console.log(`  Win Rate: ${testResult.winRate.toFixed(1)}%`);
      console.log(`  Return: ${testResult.totalReturn >= 0 ? '+' : ''}${testResult.totalReturn.toFixed(1)}%`);
      console.log(`  Final Capital: $${testResult.finalCapital.toFixed(2)}`);
      
      // Show last few trades
      if (testResult.trades > 0) {
        console.log(`  Last trade: ${testResult.trades > 0 ? 'win' : 'loss'}`);
      }
      console.log('');
    } else {
      console.log(`${pair}: No 1D data found\n`);
    }
  }

  db.close();
}

main().catch(console.error);
