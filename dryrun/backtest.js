#!/usr/bin/env node
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');

// Import engines
const FourRedDays = require('../../cce/engines/four-red-days/engine.js');

async function dryRunBacktest() {
  console.log('\n' + '═'.repeat(60));
  console.log('🧪 DRY RUN BACKTEST — Validated Strategies');
  console.log('═'.repeat(60));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log('═'.repeat(60) + '\n');

  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get BTC/USD daily candles
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
    // Convert timestamp to Date for consistency
    candle.timestampNum = candle.timestamp;
    candle.timestamp = new Date(candle.timestamp * 1000).toISOString();
    return candle;
  });

  console.log(`Candles: ${candles.length}\n`);

  // Run Four Red Days
  console.log('─'.repeat(60));
  console.log('🔴 Running: Four Red Days');
  console.log('─'.repeat(60));
  
  const engine = new FourRedDays({ status: 'dry_run', capital: 100 });
  
  for (const candle of candles) {
    engine.onCandle(candle);
  }
  
  engine.stop();
  
  console.log('\n✅ Dry run complete');
  console.log(`Log file: ${path.join(process.env.HOME, 'cce/engines/four-red-days/dryrun.log')}\n`);
}

dryRunBacktest().catch(console.error);
