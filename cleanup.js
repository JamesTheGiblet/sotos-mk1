#!/usr/bin/env node
/**
 * cleanup.js
 * Removes patch scripts, backup files, and other clutter.
 * Run from ~/kraken-intelligence/
 */

const fs   = require('fs');
const path = require('path');

const REMOVE = [
  // Patch scripts from today
  'patch_reasoning.js',
  'patch_reasoning2.js',
  'patch_rotation.js',
  'patch_performance.js',
  'cleanup_pool.js',
  'reset_pool.js',
  'fix_selector.js',
  'patch_reasoning.js',

  // Backup files
  'collect.js.backup',
  'collect.js.bak',
  'collect.js.broken',

  // Temp output
  'collect_output.log',
  'your_database_name.db',
];

let removed = 0;
let skipped = 0;

for (const file of REMOVE) {
  const full = path.join(__dirname, file);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
    console.log(`🗑️  Removed: ${file}`);
    removed++;
  } else {
    skipped++;
  }
}

console.log(`\n✅ Done. Removed ${removed} files, ${skipped} already gone.`);
console.log('\nActive system files:');
[
  'forge-reasoning.js',
  'forge-validator.js',
  'forge-monitor.js',
  'forge_auto.js',
  'collect.js',
  'analyse.js',
].forEach(f => {
  const exists = fs.existsSync(path.join(__dirname, f));
  console.log(`  ${exists ? '✅' : '❌'} ${f}`);
});
	
