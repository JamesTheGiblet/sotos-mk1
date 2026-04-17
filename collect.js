#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'data', 'intelligence.db');
const INTERVALS = ['1D', '4H', '1H'];
const INTERVAL_MINUTES = { '1D': 1440, '4H': 240, '1H': 60 };

// Focused asset list
const PAIRS = [
  'BTC/USD',
  'ETH/USD',
  'SOL/USD',
  'XRP/USD',
  'LINK/USD',
  'DOGE/USD',
  'LTC/USD',
];

let db;
let totalNewCandles = 0;

async function initDB() {
  const SQL = await initSqlJs();
  const exists = fs.existsSync(DB_PATH);
  if (exists) {
    const dbBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(dbBuffer);
  } else {
    db = new SQL.Database();
    db.run(`CREATE TABLE candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      interval TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      trades INTEGER,
      UNIQUE(pair, interval, timestamp)
    )`);
  }
  console.log('📂 Database ready');
}

function getKrakenOHLC(pair, interval, since = null) {
  return new Promise((resolve, reject) => {
    const apiPair = pair.replace('/', '');
    let url = `https://api.kraken.com/0/public/OHLC?pair=${apiPair}&interval=${interval}`;
    if (since) url += `&since=${since}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error && json.error.length) {
            reject(new Error(json.error.join(', ')));
          } else {
            resolve(json.result);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function insertCandle(pair, interval, candle) {
  const timestamp = candle[0];
  const open = parseFloat(candle[1]);
  const high = parseFloat(candle[2]);
  const low = parseFloat(candle[3]);
  const close = parseFloat(candle[4]);
  const volume = parseFloat(candle[6]);
  const trades = parseInt(candle[8]) || null;
  
  db.run(
    `INSERT OR IGNORE INTO candles (pair, interval, timestamp, open, high, low, close, volume, trades)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pair, interval, timestamp, open, high, low, close, volume, trades]
  );
}

async function collectPair(pair) {
  console.log(`\n🔵 ${pair}`);
  
  for (const interval of INTERVALS) {
    const existing = db.exec(`SELECT COUNT(*) as count FROM candles WHERE pair = ? AND interval = ?`, [pair, interval]);
    const existingCount = existing.length ? existing[0].values[0][0] : 0;
    console.log(`  📊 ${interval} — existing: ${existingCount} candles`);
    
    let since = null;
    let totalFetched = 0;
    let calls = 0;
    let hasData = false;
    
    while (calls < 20) {  // Fetch up to 20 pages (max history)
      calls++;
      try {
        const result = await getKrakenOHLC(pair, INTERVAL_MINUTES[interval], since);
        const apiPair = pair.replace('/', '');
        const candles = result[apiPair];
        
        if (!candles || candles.length === 0) {
          if (calls === 1) console.log(`  ⚠️ No data for ${interval}`);
          break;
        }
        
        hasData = true;
        
        for (const candle of candles) {
          insertCandle(pair, interval, candle);
          totalFetched++;
          totalNewCandles++;
        }
        
        const lastCandle = candles[candles.length - 1];
        since = lastCandle[0];
        
        if (candles.length < 720) break;
        await new Promise(r => setTimeout(r, 500));
        
      } catch (err) {
        console.log(`  ⚠️ Error: ${err.message}`);
        break;
      }
    }
    
    if (hasData) {
      const finalCount = db.exec(`SELECT COUNT(*) as count FROM candles WHERE pair = ? AND interval = ?`, [pair, interval])[0].values[0][0];
      console.log(`  ✅ ${interval} — ${finalCount} total candles`);
    } else if (calls === 1) {
      console.log(`  ❌ ${interval} — No data available`);
    }
  }
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🧠 KRAKEN INTELLIGENCE — Historical Data Collector');
  console.log('═'.repeat(60));
  console.log(`Pairs:     ${PAIRS.length} (6 active trading pairs)`);
  console.log(`Intervals: ${INTERVALS.join(', ')}`);
  console.log(`DB:        ${DB_PATH}`);
  console.log('═'.repeat(60));
  
  await initDB();
  
  for (const pair of PAIRS) {
    await collectPair(pair);
  }
  
  console.log(`\n🎉 Collection complete — ${totalNewCandles} new candles collected`);
  
  // Summary
  const summary = db.exec(`SELECT pair, interval, COUNT(*) as count FROM candles GROUP BY pair, interval ORDER BY pair, interval`);
  if (summary.length) {
    console.log('\n📊 COLLECTION SUMMARY');
    console.log('═'.repeat(60));
    const { columns, values } = summary[0];
    for (const row of values) {
      console.log(`  ${row[0].padEnd(12)} ${row[1].padEnd(4)} ${row[2].toString().padStart(5)} candles`);
    }
  }
  
  db.close();
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
