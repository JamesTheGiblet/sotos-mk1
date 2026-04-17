#!/usr/bin/env node
/**
 * fix_regex.js
 * Fixes the broken regex in loadPerformanceHistory
 */

const fs = require('fs');
const FILE = 'forge-reasoning.js';
let content = fs.readFileSync(FILE, 'utf8');

// Find and replace the broken blocks line
const brokenPattern = /const blocks = content\.match\([^)]*\)[^;]*;/;

const fixedLine = `const blocks = [];
    const stratPattern = /'hyp_[^']+':\\s*\\{[\\s\\S]*?(?=\\s*,\\s*\\n\\s*'|\\s*\\n\\s*}\\s*;)/g;
    let m;
    while ((m = stratPattern.exec(content)) !== null) { blocks.push(m[0]); }`;

if (brokenPattern.test(content)) {
  content = content.replace(brokenPattern, fixedLine);
  fs.writeFileSync(FILE, content);
  console.log('✅ Fixed regex in loadPerformanceHistory');
} else {
  console.log('❌ Could not find broken pattern — check manually');
  // Show context around blocks
  const idx = content.indexOf('const blocks');
  if (idx !== -1) console.log('Found at:', content.slice(idx, idx + 100));
}
