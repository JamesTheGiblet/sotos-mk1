#!/usr/bin/env node
/**
 * patch_monitor_1h.js
 * Adds 1H candle fetching to forge-monitor.js for grid trading strategies
 * Run from ~/kraken-intelligence/
 */

const fs   = require('fs');
const path = require('path');
const FILE = 'forge-monitor.js';

if (!fs.existsSync(FILE)) {
  console.error('❌ forge-monitor.js not found');
  process.exit(1);
}

let content = fs.readFileSync(FILE, 'utf8');

// Find the line that fetches OHLC and replace with timeframe-aware version
const oldFetch = `  [prices, candles] = await Promise.all([
      fetchLivePrices(['XBTUSD']),
      fetchOHLC('XBTUSD', 1440, 60)
    ]);`;

const newFetch = `  // Use 1H candles for grid strategies, daily for everything else
  const isGrid = active.strategy && active.strategy.includes('grid');
  const interval = isGrid ? 60 : 1440;
  const limit    = isGrid ? 100 : 60;

  [prices, candles] = await Promise.all([
      fetchLivePrices(['XBTUSD']),
      fetchOHLC('XBTUSD', interval, limit)
    ]);

  if (isGrid) console.log('   Using 1H candles for grid strategy');`;

if (content.includes(oldFetch)) {
  content = content.replace(oldFetch, newFetch);
  fs.writeFileSync(FILE, content);
  console.log('✅ Monitor updated — uses 1H candles for grid strategies');
  console.log('   All other strategies continue using daily candles');
} else {
  console.log('❌ Could not find fetch block — check forge-monitor.js manually');
  const idx = content.indexOf('fetchOHLC');
  if (idx !== -1) console.log('fetchOHLC found at char', idx, ':', content.slice(idx, idx + 80));
}
