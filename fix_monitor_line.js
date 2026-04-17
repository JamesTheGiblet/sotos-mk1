#!/usr/bin/env node
/**
 * fix_monitor_line.js
 * Fixes the broken line 211 in forge-monitor.js
 */

const fs = require('fs');
const FILE = 'forge-monitor.js';

let lines = fs.readFileSync(FILE, 'utf8').split('\n');

// Find and fix the broken line
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("console.log('     ' + pair + ':") && !lines[i].includes('toLocaleString')) {
    lines[i] = "    if (t) console.log('     ' + pair + ': $' + t.price.toLocaleString());";
    console.log('Fixed line ' + (i + 1) + ': ' + lines[i]);
    break;
  }
}

fs.writeFileSync(FILE, lines.join('\n'));
console.log('Done');
