#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

// Portfolio configuration
const PORTFOLIO = {
  assets: {
    'LINK/USD': { weight: 0.30, strategy: '4_red_days' },
    'BTC/USD': { weight: 0.30, strategy: '4_red_days' },
    'LTC/USD': { weight: 0.20, strategy: '4_red_days' },
    'XRP/USD': { weight: 0.20, strategy: '4_red_days' }
  },
  strategy: {
    name: '4_red_days',
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
  console.log('📊 FINAL PORTFOLIO — 4 Red Days Strategy');
  console.log('═'.repeat(60));
  console.log(`Entry: ${PORTFOLIO.strategy.requiredRed} consecutive red days`);
  console.log(`Exit: +${PORTFOLIO.strategy.targetPct}% / -${PORTFOLIO.strategy.stopPct}% / ${PORTFOLIO.strategy.maxHoldDays}d timeout`);
  console.log(`Initial Capital: $${PORTFOLIO.initialCapital}\n`);

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  let totalCapital = 0;
  const results = [];

  console.log('Per-Asset Performance:');
  console.log('─'.repeat(70));

  for (const [asset, config] of Object.entries(PORTFOLIO.assets)) {
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
      
      const assetCapital = PORTFOLIO.initialCapital * config.weight;
      const backtestResult = backtest(candles, PORTFOLIO.strategy, assetCapital);
      totalCapital += backtestResult.finalCapital;
      
      results.push({
        asset,
        weight: config.weight * 100,
        ...backtestResult
      });
    }
  }

  db.close();

  results.sort((a, b) => b.winRate - a.winRate);

  for (const r of results) {
    console.log(`  ${r.asset.padEnd(10)} | ${String(r.trades).padStart(3)} trades | ${r.winRate.toFixed(0)}% WR | ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% return | ${r.weight}% allocation`);
  }

  console.log('─'.repeat(70));
  console.log(`\n📈 PORTFOLIO SUMMARY:`);
  console.log(`  Total Capital: $${totalCapital.toFixed(2)} (start: $${PORTFOLIO.initialCapital})`);
  console.log(`  Total Return:  +${((totalCapital - PORTFOLIO.initialCapital) / PORTFOLIO.initialCapital * 100).toFixed(1)}%`);
  
  const weightedWinRate = results.reduce((sum, r) => sum + (r.winRate * r.weight / 100), 0);
  console.log(`  Weighted WR:   ${weightedWinRate.toFixed(1)}%`);
  
  console.log('\n💡 RECOMMENDATION: Ready for dry run deployment');
}

main().catch(console.error);
