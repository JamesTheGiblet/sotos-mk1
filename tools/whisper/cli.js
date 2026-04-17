#!/usr/bin/env node
const Whisper = require('./index');

const args = process.argv.slice(2);
const command = args[0];

const whisper = new Whisper();

if (command === 'scan') {
  const paths = args.slice(1);
  if (paths.length === 0) {
    // Default paths for Kraken Intelligence
    whisper.scan([
      'kraken-intelligence/strategy-bot',
      'kraken-intelligence/reasoning-bot',
      'kraken-intelligence/validation-pipeline',
      'cce/engines'
    ]);
  } else {
    whisper.scan(paths);
  }
  const passed = whisper.printReport();
  process.exit(passed ? 0 : 1);
  
} else if (command === 'version') {
  console.log('Whisper v1.0.0 — Kraken Intelligence Security Scanner');
  
} else {
  console.log(`
Whisper — Native Security Scanner for Kraken Intelligence

Usage:
  node cli.js scan [paths...]    Scan for secrets and vulnerabilities
  node cli.js version            Show version

Examples:
  node cli.js scan
  node cli.js scan ~/cce/engines ~/kraken-intelligence/strategy-bot
`);
}
