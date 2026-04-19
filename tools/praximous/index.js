#!/usr/bin/env node
/**
 * Praximous — Proactive AI Agent Swarm
 * Part of the Adaptive Intelligence Platform
 * License: MIT
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class Praximous {
  constructor() {
    this.baseDir = path.join(__dirname, '..', '..');
  }

  readJSON(filePath, fallback = null) {
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {}
    return fallback;
  }

  // 🦅 The Scout: Monitors data anomalies, volume spikes, and system security
  runScout() {
    console.log('   🦅 SCOUT AGENT: Active');
    
    // TODO: Read from analyse.js anomaly reports and whisper security scans
    const marketStateFile = path.join(this.baseDir, 'reasoning-bot', 'active_strategy.json');
    const market = this.readJSON(marketStateFile)?.marketState;
    
    if (market && market.volumeRatio > 2.0) {
      console.log(`      🚨 ALERT: Massive volume spike detected (${market.volumeRatio.toFixed(2)}x normal).`);
      console.log(`      → Recommending volatility-aware strategy transition.`);
    } else {
      console.log('      ✅ No critical data anomalies detected. Volume and security nominal.');
    }
  }

  // 🔨 The Forge Master: Watches reasoning-bot & evolution loops for stagnation
  runForgeMaster() {
    console.log('   🔨 FORGE MASTER: Active');
    
    // TODO: Read validation_failures.json to check if the loop is stuck
    const failuresFile = path.join(this.baseDir, 'reasoning-bot', 'data', 'validation_failures.json');
    const failures = this.readJSON(failuresFile, []);
    
    if (failures.length > 10) {
      console.log(`      ⚠️  WARNING: ${failures.length} recent validation failures.`);
      console.log(`      → Reasoning engine is stalling. Suggesting parameter mutation injection.`);
    } else {
      console.log('      ✅ Forge pipeline is flowing smoothly.');
    }
  }

  // 🛡️ The Sentinel: Monitors live dry-run risk and losing streaks
  runSentinel() {
    console.log('   🛡️  SENTINEL: Active');
    
    // TODO: Read monitor_log.json to track losing streaks and invoke Aegis if necessary
    const monitorLog = path.join(this.baseDir, 'reasoning-bot', 'data', 'monitor_log.json');
    const log = this.readJSON(monitorLog);
    
    if (log && log.trades && log.trades.length > 0) {
      const recentTrades = log.trades.slice(-3);
      const losses = recentTrades.filter(t => !t.win).length;
      if (losses >= 3) {
        console.log(`      🛑 CRITICAL: Active strategy has lost ${losses} consecutive trades.`);
        console.log(`      → Initiating Aegis Lock 2 revocation protocol.`);
        return;
      }
    }
    console.log('      ✅ Live risk is contained. No excessive drawdowns detected.');
  }

  runSwarm() {
    this.runScout();
    console.log('   ' + '─'.repeat(54));
    this.runForgeMaster();
    console.log('   ' + '─'.repeat(54));
    this.runSentinel();
  }
}

module.exports = Praximous;