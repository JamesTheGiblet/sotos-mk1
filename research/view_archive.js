#!/usr/bin/env node
/**
 * View Strategy Archive
 * Usage: node view_archive.js [--all|--regime RANGING]
 */

const fs = require('fs');
const path = require('path');

const ARCHIVE_FILE = path.join(__dirname, 'strategy_archive.json');

function loadArchive() {
  if (!fs.existsSync(ARCHIVE_FILE)) {
    console.log("No archive yet");
    return null;
  }
  return JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
}

const args = process.argv.slice(2);
const archive = loadArchive();

if (!archive) process.exit(0);

if (args[0] === '--all') {
  console.log(JSON.stringify(archive, null, 2));
} else if (args[0] === '--regime' && args[1]) {
  const regime = args[1].toUpperCase();
  const filtered = archive.archived_strategies.filter(s => s.regime === regime);
  console.log(JSON.stringify(filtered, null, 2));
} else if (args[0] === '--summary') {
  console.log(`Total archived: ${archive.summary.total_archived}`);
  console.log(`Avg win rate: ${archive.summary.average_win_rate?.toFixed(1) || 0}%`);
  console.log(`Avg return: ${archive.summary.average_return?.toFixed(1) || 0}%`);
  console.log(`By regime:`, archive.summary.by_regime);
} else {
  // Default: show last 10
  console.log(`\n📦 STRATEGY ARCHIVE (${archive.summary.total_archived} total)`);
  console.log("═".repeat(60));
  const recent = archive.archived_strategies.slice(0, 10);
  for (const s of recent) {
    console.log(`${s.archived_at.split('T')[0]} | ${s.name.substring(0, 35)} | ${s.metrics.win_rate?.toFixed(1) || 0}% | ${s.reason}`);
  }
}
