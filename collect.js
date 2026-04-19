#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'data', 'intelligence.db');
const INTERVALS = ['1D', '4H', '1H'];
const INTERVAL_MINUTES = { '1D': 1440, '4H': 240, '1H': 60 };

// Default active trading pairs
const defaultPairs = [
  'BTC/USD',
  'ETH/USD',
  'SOL/USD',
  'XRP/USD',
  'LINK/USD',
  'DOGE/USD',
  'LTC/USD',
];

// Allow passing custom pairs via CLI: node collect.js XAUT/USD
const PAIRS = process.argv.length > 2 ? process.argv.slice(2) : defaultPairs;

let db;
let totalNewCandles = 0;

async function initDB() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS candles (
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
  console.log('📂 Database ready');
}

function getKrakenOHLC(pair, interval, since = null, retries = 3, backoff = 5000) {
  return new Promise((resolve, reject) => {
    const apiPair = pair.replace('/', '');
    let url = `https://api.kraken.com/0/public/OHLC?pair=${apiPair}&interval=${interval}`;
    if (since) url += `&since=${since}`;
    
    https.get(url, { headers: { 'User-Agent': 'Forge/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429 || res.statusCode >= 500) {
          if (retries > 0) {
            console.log(`  ⚠️ API Limit (${res.statusCode}). Retrying in ${Math.round(backoff/1000)}s...`);
            return setTimeout(() => resolve(getKrakenOHLC(pair, interval, since, retries - 1, backoff * 1.5)), backoff);
          }
          return reject(new Error(`HTTP ${res.statusCode}: Max retries reached`));
        }
        try {
          const json = JSON.parse(data);
          if (json.error && json.error.length) return reject(new Error(json.error.join(', ')));
          resolve(json.result);
        } catch (e) {
          if (retries > 0) {
            console.log(`  ⚠️ Parse Error (Cloudflare block?). Retrying in ${Math.round(backoff/1000)}s...`);
            return setTimeout(() => resolve(getKrakenOHLC(pair, interval, since, retries - 1, backoff * 1.5)), backoff);
          }
          reject(new Error('Invalid JSON response from Kraken'));
        }
      });
    }).on('error', (err) => {
      if (retries > 0) {
        console.log(`  ⚠️ Network Error. Retrying in ${Math.round(backoff/1000)}s...`);
        return setTimeout(() => resolve(getKrakenOHLC(pair, interval, since, retries - 1, backoff * 1.5)), backoff);
      }
      reject(err);
    });
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
    const existing = db.prepare(`SELECT COUNT(*) as count FROM candles WHERE pair = ? AND interval = ?`).get(pair, interval);
    const existingCount = existing ? existing.count : 0;
    console.log(`  📊 ${interval} — existing: ${existingCount} candles`);
    
    let since = null;
    let totalFetched = 0;
    let calls = 0;
    let hasData = false;
    
    while (calls < 20) {  // Fetch up to 20 pages (max history)
      calls++;
      try {
        const result = await getKrakenOHLC(pair, INTERVAL_MINUTES[interval], since);
        const dataKey = Object.keys(result).find(k => k !== 'last');
        const candles = result[dataKey];
        
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
      const finalCount = db.prepare(`SELECT COUNT(*) as count FROM candles WHERE pair = ? AND interval = ?`).get(pair, interval).count;
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
  const summary = db.prepare(`SELECT pair, interval, COUNT(*) as count FROM candles GROUP BY pair, interval ORDER BY pair, interval`).all();
  if (summary.length) {
    console.log('\n📊 COLLECTION SUMMARY');
    console.log('═'.repeat(60));
    for (const row of summary) {
      console.log(`  ${row.pair.padEnd(12)} ${row.interval.padEnd(4)} ${row.count.toString().padStart(5)} candles`);
    }
  }
  
  if (totalNewCandles > 0) {
    console.log('\n✅ Database synced to disk (WAL mode)');
  } else {
    console.log('\n✅ Database is up to date (no new candles to save)');
  }

  db.close();
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
