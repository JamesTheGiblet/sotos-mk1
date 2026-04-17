const fs = require('fs');
const FILE = 'forge-monitor.js';
let c = fs.readFileSync(FILE, 'utf8');

// 1. Add pairs map at the top after the existing constants
const pairsMap = `
// ── Active trading pairs ───────────────────────────────────────────────────────
const TRADING_PAIRS = {
  'BTC/USD':  { kraken: 'XBTUSD',  ticker: ['XBTUSD', 'XXBTZUSD'] },
  'ETH/USD':  { kraken: 'ETHUSD',  ticker: ['ETHUSD', 'XETHZUSD'] },
  'SOL/USD':  { kraken: 'SOLUSD',  ticker: ['SOLUSD'] },
  'XRP/USD':  { kraken: 'XRPUSD',  ticker: ['XRPUSD', 'XXRPZUSD'] },
  'LINK/USD': { kraken: 'LINKUSD', ticker: ['LINKUSD'] },
  'LTC/USD':  { kraken: 'LTCUSD',  ticker: ['LTCUSD', 'XLTCZUSD'] },
  'DOGE/USD': { kraken: 'DOGEUSD', ticker: ['DOGEUSD'] }
};
`;

// Insert after the last const definition before the fetch functions
const insertAfter = 'const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes';
c = c.replace(insertAfter, insertAfter + '\n' + pairsMap);

// 2. Replace the hardcoded check section with multi-pair loop
const oldFetch = `  // Use 1H candles for grid strategies, daily for everything else
  const isGrid = active.strategy && active.strategy.includes('grid');
  const interval = isGrid ? 60 : 1440;
  const limit    = isGrid ? 100 : 60;

  [prices, candles] = await Promise.all([
      fetchLivePrices(['XBTUSD']),
      fetchOHLC('XBTUSD', interval, limit)
    ]);

  if (isGrid) console.log('   Using 1H candles for grid strategy');`;

const newFetch = `  // Use 1H candles for grid strategies, daily for everything else
  const isGrid = active.strategy && active.strategy.includes('grid');
  const interval = isGrid ? 60 : 1440;
  const limit    = isGrid ? 100 : 60;

  // Fetch all 6 pairs
  const allKrakenPairs = Object.values(TRADING_PAIRS).map(p => p.kraken);
  [prices, candles] = await Promise.all([
    fetchLivePrices(allKrakenPairs),
    fetchOHLC('XBTUSD', interval, limit)
  ]);

  if (isGrid) console.log('   Using 1H candles for grid strategy');`;

c = c.replace(oldFetch, newFetch);

// 3. Replace the ticker lookup to loop through all pairs
const oldTicker = `  const ticker       = prices['XBTUSD'] || prices['XXBTZUSD'];
  if (!ticker) { console.log('   ❌ No BTC price data'); return; }
  const currentPrice = ticker.price;
  console.log(\`   BTC: $\${currentPrice.toLocaleString()}\`);`;

const newTicker = `  // Log all pair prices
  console.log('   Prices:');
  for (const [pair, info] of Object.entries(TRADING_PAIRS)) {
    const t = info.ticker.reduce((found, key) => found || prices[key], null);
    if (t) console.log('     ' + pair + ': $' + t.price.toLocaleString());
  }

  // Primary pair for strategy evaluation (BTC unless strategy specifies otherwise)
  const ticker       = prices['XBTUSD'] || prices['XXBTZUSD'];
  if (!ticker) { console.log('   No BTC price data'); return; }
  const currentPrice = ticker.price;`;

c = c.replace(oldTicker, newTicker);

fs.writeFileSync(FILE, c);
console.log('forge-monitor.js updated for all 6 pairs');
