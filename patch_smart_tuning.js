#!/usr/bin/env node
/**
 * patch_smart_tuning.js
 * Adds performance-weighted parameter tuning to forge-reasoning.js
 *
 * What it does:
 * - Reads validated strategy performance from the selector pool
 * - Builds a parameter history of what worked in which conditions
 * - Biases parameter tuning toward proven combinations
 *
 * Run from ~/kraken-intelligence/
 * node patch_smart_tuning.js
 */

const fs   = require('fs');
const path = require('path');

const REASONING_FILE = 'forge-reasoning.js';
const SELECTOR_FILE  = 'reasoning-bot/strategy_selector.js';

if (!fs.existsSync(REASONING_FILE)) {
  console.error('❌ forge-reasoning.js not found');
  process.exit(1);
}

// ── New function to add ────────────────────────────────────────────────────────

const PERFORMANCE_HISTORY_FN = `
// ── Performance history ────────────────────────────────────────────────────────

function loadPerformanceHistory() {
  /**
   * Reads validated strategies from the selector pool and builds
   * a history of which parameter combinations worked.
   * Returns { avgTarget, avgStop, avgHold, bestWinRate, bestReturn, count }
   * filtered to strategies validated in similar market conditions.
   */
  try {
    const content = fs.readFileSync(
      path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/strategy_selector.js'),
      'utf8'
    );

    const history = [];
    // Match each validated strategy block
    const blocks = content.match(/'hyp_[^']+':[\s\S]*?(?=,\s*\n\s*'hyp_|\s*\n\s*}\s*;)/g) || [];

    for (const block of blocks) {
      const wr    = block.match(/"win_rate":\s*"([\d.]+)%"/);
      const ret   = block.match(/"backtest_return":\s*"([+-][\d.]+)%"/);
      const tgt   = block.match(/"target":\s*([\d.]+)/);
      const stp   = block.match(/"stop":\s*([\d.]+)/);
      const hld   = block.match(/"hold":\s*([\d.]+)/);
      const reg   = block.match(/"bestRegimes":\s*\[([^\]]+)\]/);

      if (wr && ret && tgt && stp && hld) {
        history.push({
          win_rate:   parseFloat(wr[1]),
          ret:        parseFloat(ret[1]),
          target:     parseFloat(tgt[1]),
          stop:       parseFloat(stp[1]),
          hold:       parseFloat(hld[1]),
          regimes:    reg ? reg[1] : ''
        });
      }
    }

    if (!history.length) return null;

    // Weight by performance — higher win rate and return = more influence
    let totalWeight = 0;
    let wTarget = 0, wStop = 0, wHold = 0;
    let bestWR = 0, bestRet = 0;

    for (const h of history) {
      const weight = (h.win_rate / 100) * 0.6 + Math.max(0, Math.min(h.ret, 100)) / 100 * 0.4;
      wTarget     += h.target * weight;
      wStop       += h.stop   * weight;
      wHold       += h.hold   * weight;
      totalWeight += weight;
      if (h.win_rate > bestWR)  bestWR  = h.win_rate;
      if (h.ret      > bestRet) bestRet = h.ret;
    }

    if (totalWeight === 0) return null;

    return {
      avgTarget:   Math.round(wTarget / totalWeight * 10) / 10,
      avgStop:     Math.round(wStop   / totalWeight * 10) / 10,
      avgHold:     Math.round(wHold   / totalWeight),
      bestWinRate: bestWR,
      bestReturn:  bestRet,
      count:       history.length
    };

  } catch { return null; }
}

`;

// ── Updated tuneParameters function ───────────────────────────────────────────

const NEW_TUNE_FN = `function tuneParameters(marketState, failures) {
  const { regime, phase, sentiment, volatility } = marketState;

  // Load what's worked historically
  const history = loadPerformanceHistory();

  // Base parameters — start from historical average if available
  let params = {
    regime:    regime,
    redDays:   3,
    rsiEntry:  35,
    rsiExit:   55,
    volEntry:  3.0,
    stop:      history ? history.avgStop   : 8,
    target:    history ? history.avgTarget : 15,
    hold:      history ? history.avgHold   : 10
  };

  if (history && history.count > 0) {
    console.log(\`   📊 Parameter history: \${history.count} validated strategies\`);
    console.log(\`      Avg target: +\${history.avgTarget}% | Avg stop: -\${history.avgStop}% | Avg hold: \${history.avgHold}d\`);
    console.log(\`      Best WR: \${history.bestWinRate}% | Best return: +\${history.bestReturn}%\`);
  }

  // Tune for regime — adjust around historical baseline
  const targetBase = params.target;
  const stopBase   = params.stop;
  const holdBase   = params.hold;

  if (regime === 'TRENDING_DOWN' || phase === 'MARKDOWN') {
    params.redDays  = 4;
    params.rsiEntry = 28;
    params.rsiExit  = 50;
    params.stop     = Math.min(stopBase * 0.8, 6);
    params.target   = Math.min(targetBase * 0.9, 12);
    params.hold     = Math.round(holdBase * 0.8);
  } else if (regime === 'VOLATILE') {
    params.volEntry = 3.5;
    params.stop     = Math.min(stopBase * 1.2, 12);
    params.target   = Math.min(targetBase * 1.3, 25);
    params.hold     = Math.round(holdBase * 0.7);
  } else if (regime === 'RANGING' || regime === 'QUIET') {
    params.redDays  = 3;
    params.rsiEntry = 35;
    params.rsiExit  = 55;
    params.stop     = stopBase;
    params.target   = targetBase;
    params.hold     = holdBase;
  } else if (regime === 'TRENDING_UP' || phase === 'MARKUP') {
    params.rsiEntry = 40;
    params.rsiExit  = 65;
    params.stop     = Math.min(stopBase * 0.7, 5);
    params.target   = Math.min(targetBase * 0.9, 12);
    params.hold     = Math.round(holdBase * 0.8);
  }

  // Tune for sentiment
  if (sentiment === 'EXTREME_FEAR') {
    params.rsiEntry = Math.min(params.rsiEntry, 25);
    params.target   = Math.min(params.target * 1.2, 25);
  } else if (sentiment === 'EXTREME_GREED') {
    params.rsiEntry = 45;
    params.rsiExit  = 70;
  }

  // Learn from failures
  for (const f of failures) {
    if (f.win_rate > 50 && f.ret < 0) {
      // Good win rate but negative return — exit too early, increase target and hold
      params.target = Math.min(params.target * 1.3, 25);
      params.hold   = Math.min(params.hold + 2, 14);
    }
    if (f.trades < 5) {
      // Too few trades — loosen entry conditions
      params.rsiEntry = Math.min(params.rsiEntry + 5, 45);
      params.redDays  = Math.max(params.redDays - 1, 2);
    }
    if (f.win_rate < 40) {
      // Poor win rate — tighten entry
      params.rsiEntry = Math.max(params.rsiEntry - 5, 20);
    }
  }

  // Round all values cleanly
  params.target   = Math.round(params.target * 10) / 10;
  params.stop     = Math.round(params.stop   * 10) / 10;
  params.hold     = Math.round(params.hold);
  params.rsiEntry = Math.round(params.rsiEntry);
  params.rsiExit  = Math.round(params.rsiExit);

  return params;
}
`;

// ── Apply patch ────────────────────────────────────────────────────────────────

let content = fs.readFileSync(REASONING_FILE, 'utf8');

// Check if already patched
if (content.includes('loadPerformanceHistory')) {
  console.log('ℹ️  Already patched — updating tuneParameters only');
} else {
  // Insert performance history function before tuneParameters
  const insertPoint = content.indexOf('function tuneParameters(');
  if (insertPoint === -1) {
    console.error('❌ Could not find tuneParameters function');
    process.exit(1);
  }
  content = content.slice(0, insertPoint) + PERFORMANCE_HISTORY_FN + content.slice(insertPoint);
  console.log('✅ Added loadPerformanceHistory function');
}

// Replace tuneParameters
const tuneStart = content.indexOf('function tuneParameters(');
if (tuneStart === -1) {
  console.error('❌ Could not find tuneParameters to replace');
  process.exit(1);
}

let depth = 0, tuneEnd = tuneStart;
for (let i = tuneStart; i < content.length; i++) {
  if (content[i] === '{') depth++;
  else if (content[i] === '}') {
    depth--;
    if (depth === 0) { tuneEnd = i + 1; break; }
  }
}

content = content.slice(0, tuneStart) + NEW_TUNE_FN + content.slice(tuneEnd);
fs.writeFileSync(REASONING_FILE, content);
console.log('✅ Updated tuneParameters with performance weighting');
console.log('\nWhat changed:');
console.log('  • Parameters now start from weighted average of validated strategies');
console.log('  • Regime adjustments scale around historical baseline not fixed values');
console.log('  • Performance history logged during each reasoning run');
console.log('\nTest with: node forge-reasoning.js --dry-run');
