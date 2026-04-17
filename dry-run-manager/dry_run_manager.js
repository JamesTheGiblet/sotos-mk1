cat > dry_run_manager.js << 'EOF'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class DryRunManager {
  constructor() {
    this.generatedDir = path.join(process.env.HOME, 'cce', 'engines', 'generated');
    this.dryRunDir = path.join(process.env.HOME, 'cce', 'engines', 'dry-run');
    this.requiredDays = 30;
    this.statusFile = path.join(this.dryRunDir, 'dry_run_status.json');
    this.init();
  }

  init() {
    if (!fs.existsSync(this.dryRunDir)) {
      fs.mkdirSync(this.dryRunDir, { recursive: true });
    }
    if (!fs.existsSync(this.statusFile)) {
      fs.writeFileSync(this.statusFile, JSON.stringify({ strategies: [] }, null, 2));
    }
  }

  loadStatus() {
    return JSON.parse(fs.readFileSync(this.statusFile, 'utf8'));
  }

  saveStatus(status) {
    fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
  }

  getGeneratedStrategies() {
    if (!fs.existsSync(this.generatedDir)) return [];
    return fs.readdirSync(this.generatedDir)
      .filter(f => fs.statSync(path.join(this.generatedDir, f)).isDirectory())
      .map(f => ({
        name: f,
        path: path.join(this.generatedDir, f),
        generated: fs.statSync(path.join(this.generatedDir, f)).birthtime
      }));
  }

  getDryRunStrategies() {
    if (!fs.existsSync(this.dryRunDir)) return [];
    return fs.readdirSync(this.dryRunDir)
      .filter(f => fs.statSync(path.join(this.dryRunDir, f)).isDirectory())
      .map(f => ({
        name: f,
        path: path.join(this.dryRunDir, f),
        status: this.getStrategyStatus(f)
      }));
  }

  getStrategyStatus(strategyName) {
    const status = this.loadStatus();
    const strategy = status.strategies.find(s => s.name === strategyName);
    if (!strategy) return { dryRunDays: 0, status: 'pending', canGoLive: false };
    return strategy;
  }

  addToDryRun(strategyName, strategyPath) {
    const dryRunPath = path.join(this.dryRunDir, strategyName);
    
    // Copy strategy to dry-run directory
    if (!fs.existsSync(dryRunPath)) {
      this.copyDirectory(strategyPath, dryRunPath);
      console.log(`📁 Copied ${strategyName} to dry-run directory`);
    }
    
    // Update status
    const status = this.loadStatus();
    const existing = status.strategies.find(s => s.name === strategyName);
    
    if (!existing) {
      status.strategies.push({
        name: strategyName,
        path: dryRunPath,
        dryRunDays: 0,
        startDate: new Date().toISOString(),
        status: 'dry_run',
        canGoLive: false,
        trades: 0,
        winRate: 0,
        totalReturn: 0
      });
      this.saveStatus(status);
      console.log(`📝 Added ${strategyName} to dry run tracking`);
    }
    
    // Install dependencies
    try {
      execSync(`cd ${dryRunPath} && npm init -y > /dev/null 2>&1 && npm install sql.js > /dev/null 2>&1`, { stdio: 'pipe' });
      console.log(`📦 Installed dependencies for ${strategyName}`);
    } catch (err) {
      console.log(`⚠️ Could not install dependencies for ${strategyName}`);
    }
    
    return dryRunPath;
  }

  copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    for (const file of files) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      if (fs.statSync(srcPath).isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  startDryRun(strategyName) {
    const dryRunPath = path.join(this.dryRunDir, strategyName);
    if (!fs.existsSync(dryRunPath)) {
      console.log(`❌ Strategy ${strategyName} not found in dry-run directory`);
      return false;
    }
    
    // Check if already running
    const pm2Check = execSync(`pm2 list | grep "${strategyName}-dry" || true`, { stdio: 'pipe' }).toString();
    if (pm2Check.includes(strategyName)) {
      console.log(`⚠️ ${strategyName} is already running in dry run mode`);
      return false;
    }
    
    // Start with PM2
    try {
      execSync(`cd ${dryRunPath} && pm2 start monitor.js --name "${strategyName}-dry"`, { stdio: 'pipe' });
      console.log(`🚀 Started dry run for ${strategyName}`);
      
      // Update status
      const status = this.loadStatus();
      const strategy = status.strategies.find(s => s.name === strategyName);
      if (strategy) {
        strategy.status = 'running';
        strategy.pm2Name = `${strategyName}-dry`;
        strategy.startDate = new Date().toISOString();
        this.saveStatus(status);
      }
      return true;
    } catch (err) {
      console.log(`❌ Failed to start ${strategyName}:`, err.message);
      return false;
    }
  }

  stopDryRun(strategyName) {
    try {
      execSync(`pm2 stop "${strategyName}-dry" && pm2 delete "${strategyName}-dry"`, { stdio: 'pipe' });
      console.log(`🛑 Stopped dry run for ${strategyName}`);
      
      const status = this.loadStatus();
      const strategy = status.strategies.find(s => s.name === strategyName);
      if (strategy) {
        strategy.status = 'stopped';
        this.saveStatus(status);
      }
      return true;
    } catch (err) {
      console.log(`⚠️ Could not stop ${strategyName}:`, err.message);
      return false;
    }
  }

  updateDryRunDays() {
    const status = this.loadStatus();
    let updated = false;
    
    for (const strategy of status.strategies) {
      if (strategy.status === 'running') {
        const startDate = new Date(strategy.startDate);
        const now = new Date();
        const days = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        
        if (days !== strategy.dryRunDays) {
          strategy.dryRunDays = days;
          updated = true;
          
          // Check if 30 days completed
          if (days >= this.requiredDays && !strategy.canGoLive) {
            strategy.canGoLive = true;
            strategy.status = 'ready';
            console.log(`🎉 ${strategy.name} has completed ${days} days of dry run! Ready for live deployment.`);
          }
        }
      }
    }
    
    if (updated) this.saveStatus(status);
  }

  getReadyStrategies() {
    const status = this.loadStatus();
    return status.strategies.filter(s => s.canGoLive === true);
  }

  promoteToLive(strategyName) {
    const dryRunPath = path.join(this.dryRunDir, strategyName);
    const livePath = path.join(process.env.HOME, 'cce', 'engines', 'live', strategyName);
    
    if (!fs.existsSync(livePath)) {
      fs.mkdirSync(livePath, { recursive: true });
      this.copyDirectory(dryRunPath, livePath);
    }
    
    // Update manifest to live
    const manifestPath = path.join(livePath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.status = 'live';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
    
    // Stop dry run
    this.stopDryRun(strategyName);
    
    // Start live
    try {
      execSync(`cd ${livePath} && pm2 start monitor.js --name "${strategyName}"`, { stdio: 'pipe' });
      console.log(`🚀 Promoted ${strategyName} to LIVE!`);
      
      const status = this.loadStatus();
      const strategy = status.strategies.find(s => s.name === strategyName);
      if (strategy) {
        strategy.status = 'live';
        strategy.liveDate = new Date().toISOString();
        this.saveStatus(status);
      }
      return true;
    } catch (err) {
      console.log(`❌ Failed to start live:`, err.message);
      return false;
    }
  }

  printStatus() {
    const status = this.loadStatus();
    console.log('\n' + '='.repeat(70));
    console.log('📊 DRY RUN STATUS');
    console.log('='.repeat(70));
    
    if (status.strategies.length === 0) {
      console.log('\n  No strategies in dry run.');
    } else {
      for (const s of status.strategies) {
        const progress = Math.floor((s.dryRunDays / this.requiredDays) * 100);
        const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
        const daysLeft = this.requiredDays - s.dryRunDays;
        
        console.log(`\n  ${s.name}`);
        console.log(`    Status: ${s.status.toUpperCase()}`);
        console.log(`    Dry Run: ${bar} ${progress}% (${s.dryRunDays}/${this.requiredDays} days)`);
        if (s.canGoLive) {
          console.log(`    ✅ READY FOR LIVE DEPLOYMENT`);
        } else if (daysLeft > 0) {
          console.log(`    ⏳ ${daysLeft} days remaining`);
        }
        if (s.trades > 0) {
          console.log(`    Performance: ${s.trades} trades | ${s.winRate}% WR | ${s.totalReturn}% return`);
        }
      }
    }
    console.log('\n' + '='.repeat(70));
  }

  autoAddNewStrategies() {
    const generated = this.getGeneratedStrategies();
    const existing = this.getDryRunStrategies().map(s => s.name);
    
    for (const strategy of generated) {
      if (!existing.includes(strategy.name)) {
        console.log(`\n🔍 New strategy detected: ${strategy.name}`);
        this.addToDryRun(strategy.name, strategy.path);
        this.startDryRun(strategy.name);
      }
    }
  }

  run() {
    // Update dry run days counter
    this.updateDryRunDays();
    
    // Auto-add new strategies
    this.autoAddNewStrategies();
    
    // Print status
    this.printStatus();
    
    // Return ready strategies
    return this.getReadyStrategies();
  }
}

module.exports = DryRunManager;
EOF

  // Add Aegis integration
  updateAegisCompliance() {
    try {
      const Aegis = require('../tools/aegis/index');
      const aegis = new Aegis();
      aegis.updateDryRunDays(this.state.dryRunDays);
      
      // Check if validation passed
      const validationFile = path.join(this.generatedDir, this.state.currentEngine?.name, 'validation_result.json');
      if (fs.existsSync(validationFile)) {
        const validation = JSON.parse(fs.readFileSync(validationFile, 'utf8'));
        if (validation.passed) {
          aegis.recordValidation(this.state.currentEngine.name, validation);
        }
      }
    } catch (err) {
      // Aegis not installed yet
    }
  }
