#!/usr/bin/env node
/**
 * dedup_pool.js
 * Removes duplicate strategies from strategy_selector.js
 * Keeps one entry per unique strategy name.
 * Run from ~/kraken-intelligence/
 */

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'reasoning-bot/strategy_selector.js');

if (!fs.existsSync(FILE)) {
  console.error('❌ strategy_selector.js not found');
  process.exit(1);
}

let content = fs.readFileSync(FILE, 'utf8');

// Count before
const beforeCount = (content.match(/'[^']+'\s*:/g) || []).length;

// Find all generated hypothesis entries (hyp_ prefixed)
// Keep only the first occurrence of each unique name
const seen = new Set();
let removed = 0;

// Match each hyp_ strategy block
content = content.replace(
  /,\s*\n(\s*'hyp_[^']+'\s*:\s*\{[\s\S]*?\}(?=\s*[,\n]))/g,
  (match, block) => {
    const nameMatch = block.match(/"name"\s*:\s*"([^"]+)"/);
    if (!nameMatch) return match;
    const name = nameMatch[1];
    if (seen.has(name)) {
      removed++;
      return ''; // Remove duplicate
    }
    seen.add(name);
    return match; // Keep first occurrence
  }
);

const afterCount = (content.match(/'[^']+'\s*:/g) || []).length;

fs.writeFileSync(FILE, content);

console.log(`✅ Deduplication complete`);
console.log(`   Removed: ${removed} duplicate entries`);
console.log(`   Remaining strategies: ${afterCount}`);
console.log('\n   Unique validated strategies kept:');
seen.forEach(name => console.log(`   • ${name}`));

