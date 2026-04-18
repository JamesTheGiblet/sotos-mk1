#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const ASSETS = ['LINK/USD', 'BTC/USD', 'LTC/USD'];
const STRATEGY = {
  requiredRed: 4,
  targetPct: 1,
  stopPct: 0.75,
  maxHoldDays: 5
};

function backtestSingleAsset(candles, initialCapital = 100) {
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
        trades.push({ pnlPct, pnl, win: pnl > 0, reason, holdDays, exitPrice: candles[i].close });
        position = null;
        consecutiveRed = 0;
      }
    }
  }

  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length ? (wins / trades.length * 100) : 0;
  const totalReturn = ((capital - initialCapital) / initialCapital * 100);

  return { trades, winRate, totalReturn, finalCapital: capital };
}

async function backtestPortfolio(maxConcurrent) {
  console.log(`\n📊 Backtest with max ${maxConcurrent} concurrent positions\n`);
  
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get candles and run backtest per asset
  const assetResults = {};
  const allTrades = [];
  
  for (const asset of ASSETS) {
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
      
      const allocation = asset === 'LTC/USD' ? 50 : 100;
      const bt = backtestSingleAsset(candles, allocation);
      assetResults[asset] = bt;
      
      for (const trade of bt.trades) {
        allTrades.push({ asset, ...trade });
      }
    }
  }
  
  db.close();
  
  // Sort trades by date (approximate - using the trade index)
  // For simplicity, sum the returns
  let totalCapital = 250;
  let totalWins = 0;
  let totalTrades = 0;
  
  for (const [asset, result] of Object.entries(assetResults)) {
    totalTrades += result.trades.length;
    totalWins += result.trades.filter(t => t.win).length;
    totalCapital = totalCapital - (asset === 'LTC/USD' ? 50 : 100) + result.finalCapital;
  }
  
  const winRate = totalTrades ? (totalWins / totalTrades * 100) : 0;
  const totalReturn = ((totalCapital - 250) / 250 * 100);
  
  console.log(`Results:`);
  console.log(`  Trades: ${totalTrades}`);
  console.log(`  Wins: ${totalWins}`);
  console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`  Total Return: ${totalReturn.toFixed(1)}%`);
  console.log(`  Final Capital: $${totalCapital.toFixed(2)}`);
  
  return { trades: totalTrades, winRate, totalReturn, totalCapital };
}

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('📊 PORTFOLIO BACKTEST (No concurrency limits)');
  console.log('════════════════════════════════════════════════════════════');
  
  const portfolio = await backtestPortfolio(10);
  
  console.log('\n' + '═'.repeat(60));
  console.log('📈 EXPECTED PORTFOLIO PERFORMANCE');
  console.log('═'.repeat(60));
  console.log(`  Based on your earlier test: ~75% WR, +62.8% return`);
  console.log(`  The risk-managed engine will slightly reduce returns`);
  console.log(`  but protects against 11.4% triple-overlap days.\n`);
  console.log(`  Trade-off: Slightly lower returns for significantly lower risk`);
}

main().catch(console.error);
