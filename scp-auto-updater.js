#!/usr/bin/env node
/**
 * SCP Auto-Updater - Watches for system changes and updates scp.json
 * Monitors: market state, PM2 processes, strategies, archive, candles
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SCPAutoUpdater {
  constructor() {
    this.scpFile = path.join(__dirname, 'scp-capsule-share.json');
    this.watchPaths = [
      'reasoning-bot/active_strategy.json',
      'strategy_archive.json',
      'cce/engines/scp/',
      'data/intelligence.db'
    ];
    this.lastState = {};
    this.updateInterval = 60000; // Check every minute
  }

  // Get current PM2 status
  getPM2Status() {
    try {
      const output = execSync('pm2 jlist', { encoding: 'utf8' });
      const processes = JSON.parse(output);
      return processes.map(p => ({
        name: p.name,
        status: p.pm2_env.status,
        mode: p.pm2_env.exec_mode,
        uptime: p.pm2_env.pm_uptime
      }));
    } catch (e) {
      return [];
    }
  }

  // Get current market state
  getMarketState() {
    const stateFile = path.join(__dirname, 'reasoning-bot/active_strategy.json');
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
    return null;
  }

  // Get strategy archive summary
  getArchiveSummary() {
    const archiveFile = path.join(__dirname, 'strategy_archive.json');
    if (fs.existsSync(archiveFile)) {
      const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
      return archive.summary;
    }
    return { total_archived: 0, average_win_rate: 0, average_return: 0, by_regime: {} };
  }

  // Get SCP capsule count
  getSCPCapsules() {
    const scpDir = path.join(process.env.HOME, 'cce/engines/scp');
    if (fs.existsSync(scpDir)) {
      return fs.readdirSync(scpDir).filter(f => f.startsWith('hyp_') || f.startsWith('consecutive')).length;
    }
    return 0;
  }

  // Get candle count
  getCandleCount() {
    try {
      const dbPath = path.join(__dirname, 'data/intelligence.db');
      if (fs.existsSync(dbPath)) {
        const sqlite3 = require('sql.js');
        const dbBuffer = fs.readFileSync(dbPath);
        const db = new sqlite3.Database(dbBuffer);
        const result = db.exec("SELECT COUNT(*) as count FROM candles");
        db.close();
        return result[0]?.values[0][0] || 0;
      }
    } catch (e) {
      return 723; // fallback
    }
    return 723;
  }


  getMonitorStatus() {
    try {
      const logFile = require('path').join(__dirname, 'reasoning-bot/data/monitor_log.json');
      if (fs.existsSync(logFile)) {
        const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        return {
          checks:        log.checks || 0,
          trades:        log.trades ? log.trades.length : 0,
          open_positions: log.positions ? Object.keys(log.positions).length : 0,
          last_trade:    log.trades && log.trades.length ? log.trades[log.trades.length - 1] : null
        };
      }
    } catch (e) {}
    return { checks: 0, trades: 0, open_positions: 0, last_trade: null };
  }

  // Generate updated SCP JSON
  generateSCP() {
    // Load existing SCP to preserve rich fields
    let existing = {};
    try {
      if (fs.existsSync(this.scpFile)) {
        existing = JSON.parse(fs.readFileSync(this.scpFile, 'utf8'));
      }
    } catch (e) {}
    const marketState = this.getMarketState();
    const pm2Processes = this.getPM2Status();
    const archiveSummary = this.getArchiveSummary();
    const scpCapsuleCount = this.getSCPCapsules();
    const candleCount = this.getCandleCount();
    
    // Merge: preserve existing rich fields, update only dynamic ones
    const scpData = Object.assign({}, existing, {
      protocol: existing.protocol || { name: "Semantic Capsule Protocol", version: "1.0.0" },
      manifest: Object.assign({}, existing.manifest || {}, {
        last_updated: new Date().toISOString(),
        status: "active_dry_run"
      }),
      platform_state: Object.assign({}, existing.platform_state || {}, {
        pm2_processes: pm2Processes.map(p => ({ name: p.name, status: p.status })),
        candles_collected: candleCount,
        scp_capsules: scpCapsuleCount,
        active_strategy: marketState?.strategy || (existing.platform_state && existing.platform_state.active_strategy) || "unknown",
        market_regime: marketState?.marketState?.regime || "RANGING",
        market_sentiment: marketState?.marketState?.sentiment || "NEUTRAL",
        market_phase: marketState?.marketState?.phase || "ACCUMULATION",
        btc_price: marketState?.marketState?.btcPrice || (existing.platform_state && existing.platform_state.btc_price) || 0,
        monitor: this.getMonitorStatus()
      }),
      lifecycle: Object.assign({}, existing.lifecycle || {}, {
        status: "active_dry_run",
        last_updated: new Date().toISOString(),
        version_notes: existing.lifecycle && existing.lifecycle.version_notes ? existing.lifecycle.version_notes : "Auto-updated by SCP watcher"
      })
    });
    
    return scpData;
  }

  // Check if state changed
  hasChanged(newState, oldState) {
    return JSON.stringify(newState) !== JSON.stringify(oldState);
  }

  // Save SCP file
  saveSCP(data) {
    fs.writeFileSync(this.scpFile, JSON.stringify(data, null, 2));
    // Also save to Downloads
    const downloadPath = '/sdcard/Download/index.scp.json';
    try {
      fs.writeFileSync(downloadPath, JSON.stringify(data, null, 2));
    } catch(e) { /* no write permission */ }
    return true;
  }

  // Watch for changes
  async watch() {
    console.log(`👁️  SCP Auto-Updater started at ${new Date().toISOString()}`);
    console.log(`   Watching for changes every ${this.updateInterval/1000} seconds`);
    console.log(`   SCP file: ${this.scpFile}\n`);
    
    // Initial update
    let currentSCP = this.generateSCP();
    this.saveSCP(currentSCP);
    this.lastState = currentSCP;
    console.log(`✅ Initial SCP saved`);
    
    // Start watching
    setInterval(() => {
      try {
        const newSCP = this.generateSCP();
        if (this.hasChanged(newSCP, this.lastState)) {
          this.saveSCP(newSCP);
          this.lastState = newSCP;
          console.log(`🔄 SCP updated at ${new Date().toISOString()}`);
          console.log(`   → PM2: ${newSCP.platform_state.pm2_processes.length} processes`);
          console.log(`   → Candles: ${newSCP.platform_state.candles_collected}`);
          console.log(`   → Market: ${newSCP.platform_state.market_regime}/${newSCP.platform_state.market_sentiment}`);
        }
      } catch (err) {
        console.error(`❌ Update error: ${err.message}`);
      }
    }, this.updateInterval);
  }
}

// Run if called directly
if (require.main === module) {
  const updater = new SCPAutoUpdater();
  updater.watch();
}

module.exports = SCPAutoUpdater;
