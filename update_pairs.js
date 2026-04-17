const fs = require('fs');
let content = fs.readFileSync('collect.js', 'utf8');

const oldPairs = `// Focused asset list
const PAIRS = [
  // Top 5 Crypto
  'BTC/USD',
  'ETH/USD',
  'SOL/USD',
  'XRP/USD',
  'DOGE/USD',
  // Underdogs
  'LINK/USD',
  'LTC/USD',
  'ADA/USD',`;

const newPairs = `// Active trading pairs only
const PAIRS = [
  'BTC/USD',
  'ETH/USD',
  'SOL/USD',
  'XRP/USD',
  'LINK/USD',
  'LTC/USD',`;

if (content.includes(oldPairs)) {
  content = content.replace(oldPairs, newPairs);
  fs.writeFileSync('collect.js', content);
  console.log('✅ Pairs updated to 6 active trading pairs');
} else {
  console.log('❌ Could not find pair block — check manually');
}
