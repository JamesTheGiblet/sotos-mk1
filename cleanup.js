#!/usr/bin/env node
/**
 * cleanup.js
 * Removes patch scripts, backup files, and other clutter.
 * Run from ~/kraken-intelligence/
 */

const fs   = require('fs');
const path = require('path');

// 1. Explicit files to remove (one-off patches, fixes, and builders)
const REMOVE_EXACT = [
  'patch_reasoning.js',
  'patch_reasoning2.js',
  'patch_rotation.js',
  'patch_performance.js',
  'cleanup_pool.js',
  'reset_pool.js',
  'fix_selector.js',
  'dedup-pool.js',
  'fix_monitor_line.js',
  'fix_gemini.js',
  'fix_gemini2.js',
  'fix_scp_watcher.js',
  'fix_strategy_display.js',
  'fix_monitor_pairs.js',
  'fix_regex.js',
  'add_auth.js',
  'add_emergent.js',
  'patch_golem_actions.js',
  'patch_monitor_1h.js',
  'patch_scp_watcher.js',
  'patch_smart_tuning.js',
  'restore_scp.js',
  'update_pairs.js',
  'README-share.md',
  'PLATFORM_COMPLETE.md',
  'kraken-intelligence-complete.tar.gz',
  'install_smart_discovery.py',
  'grid-trading-1h.scp.json',
  'strategy_archive.json',
  'scp-capsule-share.json',
  'cli.js',
  'golem.js',

  // Temp output
  'collect_output.log',
  'your_database_name.db',
];

// 2. Extensions to scrub dynamically
const SCRUB_EXTENSIONS = ['.backup', '.bak', '.broken', '.tmp'];
const DIRS_TO_SCRUB = [
  __dirname,
  path.join(__dirname, 'reasoning-bot'),
  path.join(__dirname, 'data')
];

let removed = 0;
let skipped = 0;

// 3. Files to move to a research/experiments folder
const RESEARCH_FILES = [
  'backtest_grid.js',
  'backtest_with_risk.js',
  'check_overlap.js',
  'collect_gold.js',
  'grid_optimise.js',
  'grid_optimise_1h.js',
  'listener_backtest.js',
  'portfolio_engine.js',
  'portfolio_forward.js',
  'portfolio_forward_no_xrp.js',
  'test_altcoins.js',
  'test_gold_strategy.js',
  'view_archive.js'
];

// 4. Files to move to a tests folder
const TEST_FILES = [
  'test_integration.sh',
  'final_verification.sh'
];

// 5. Legacy folders to completely purge
const LEGACY_DIRS = [
  'dashboard',
  'dryrun',
  'dry-run-manager',
  'rules',
  'optimization',
  'reports',
  'strategies',
  'strategy-bot',
  'validation-pipeline',
  'analysis',
  'simulation',
  'scripts',
  'share',
  'watermarks'
];

console.log('🧹 FORGE CLEANUP UTILITY');
console.log('='.repeat(40));

// Phase 1: Exact matches
for (const file of REMOVE_EXACT) {
  const full = path.join(__dirname, file);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
    console.log(`🗑️  Removed: ${file}`);
    removed++;
  } else {
    skipped++;
  }
}

// Phase 2: Dynamic scrub
console.log('\n🔍 Scrubbing for backup and broken files...');
for (const dir of DIRS_TO_SCRUB) {
  if (!fs.existsSync(dir)) continue;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isFile()) {
      const matchesScrub = SCRUB_EXTENSIONS.some(suffix => file.endsWith(suffix));
      if (matchesScrub) {
        fs.unlinkSync(fullPath);
        console.log(`🗑️  Scrubbed: ${path.relative(__dirname, fullPath)}`);
        removed++;
      }
    }
  }
}

// Phase 3: Organize research files
console.log('\n📁 Organizing research files...');
const researchDir = path.join(__dirname, 'research');
if (!fs.existsSync(researchDir)) {
  fs.mkdirSync(researchDir);
}
let moved = 0;
for (const file of RESEARCH_FILES) {
  const full = path.join(__dirname, file);
  if (fs.existsSync(full)) {
    fs.renameSync(full, path.join(researchDir, file));
    console.log(`📦 Moved to research/: ${file}`);
    moved++;
  }
}

// Phase 4: Organize test files
console.log('\n🧪 Organizing test scripts...');
const testsDir = path.join(__dirname, 'tests');
if (!fs.existsSync(testsDir)) {
  fs.mkdirSync(testsDir);
}
for (const file of TEST_FILES) {
  const full = path.join(__dirname, file);
  if (fs.existsSync(full)) {
    fs.renameSync(full, path.join(testsDir, file));
    console.log(`📦 Moved to tests/: ${file}`);
    moved++;
  }
}

// Phase 5: Purge legacy directories
console.log('\n🔥 Purging legacy directories...');
let dirsRemoved = 0;
for (const dir of LEGACY_DIRS) {
  const fullPath = path.join(__dirname, dir);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log(`🧨 Destroyed legacy folder: ${dir}/`);
    dirsRemoved++;
  }
}

console.log(`\n✅ Done.`);
console.log(`   Files removed: ${removed} | Files moved: ${moved} | Folders destroyed: ${dirsRemoved}`);
console.log('\nActive system files:');
[
  'forge-reasoning.js',
  'forge-validator.js',
  'forge-monitor.js',
  'forge_auto.js',
  'forge-dashboard.js',
  'forge-actions.js',
  'forge-evolution.js',
  'collect.js',
  'analyse.js',
  'server.js',
  'scp-auto-updater.js',
  'chronoscribe.js',
  'regime_watcher.js'
].forEach(f => {
  const exists = fs.existsSync(path.join(__dirname, f));
  console.log(`  ${exists ? '✅' : '❌'} ${f}`);
});
	
