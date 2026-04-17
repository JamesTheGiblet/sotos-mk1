#!/usr/bin/env node
const fs = require('fs');
const c  = fs.readFileSync('forge-dashboard.js', 'utf8');

const oldLine = "setText('active-strat', strat.name || '\u2014');";
const newLine = "setText('active-strat', strat.name || '\u2014');\n  try {\n    const selContent = fs.readFileSync(require('path').join(require('os').homedir(), 'kraken-intelligence/reasoning-bot/strategy_selector.js'), 'utf8');\n    const sid = state.strategy && state.strategy.id;\n    if (sid) {\n      const sidx = selContent.indexOf(\"'\" + sid + \"':\");\n      if (sidx !== -1) {\n        const block = selContent.slice(sidx, sidx + 500);\n        const em = block.match(/\"entry\":\\s*\"([^\"]+)\"/);\n        if (em) document.getElementById('strat-conditions').textContent = em[1];\n      }\n    }\n  } catch(e) {}";

if (c.includes(oldLine)) {
  fs.writeFileSync('forge-dashboard.js', c.replace(oldLine, newLine));
  console.log('Fixed');
} else {
  console.log('Target not found — checking what is there:');
  const idx = c.indexOf('active-strat');
  console.log(c.slice(idx, idx + 100));
}
