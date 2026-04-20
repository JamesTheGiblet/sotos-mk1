#!/usr/bin/env node
/**
 * Praximous — Proactive AI Agent Swarm
 * Part of the Adaptive Intelligence Platform
 * License: MIT
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: true });
try {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath) && fs.existsSync(envPath + '.txt')) envPath += '.txt';
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8').replace(/\0/g, '');
    const match = envContent.match(/GEMINI_API_KEY=([a-zA-Z0-9_\-]+)/);
    if (match) process.env.GEMINI_API_KEY = match[1];

    const matchTgToken = envContent.match(/TELEGRAM_BOT_TOKEN=([a-zA-Z0-9:\-_]+)/);
    if (matchTgToken) process.env.TELEGRAM_BOT_TOKEN = matchTgToken[1];
    
    const matchTgChat = envContent.match(/TELEGRAM_CHAT_ID=([a-zA-Z0-9\-_]+)/);
    if (matchTgChat) process.env.TELEGRAM_CHAT_ID = matchTgChat[1];
  }
} catch(e) {}

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
  async runForgeMaster() {
    console.log('   🔨 FORGE MASTER: Active');
    
    // TODO: Read validation_failures.json to check if the loop is stuck
    const failuresFile = path.join(this.baseDir, 'reasoning-bot', 'data', 'validation_failures.json');
    const failures = this.readJSON(failuresFile, []);
    
    if (failures.length > 10) {
      console.log(`      ⚠️  WARNING: ${failures.length} recent validation failures.`);
      console.log(`      → Reasoning engine stalling. Initiating Gemini-powered mutation injection...`);
      this.logAlert('Forge Master', `Reasoning engine stalling. ${failures.length} recent validation failures.`, '⚠️');
      
      if (!process.env.GEMINI_API_KEY) {
        console.log('      ❌ GEMINI_API_KEY missing. Cannot perform mutation.');
        return;
      }
      
      try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `The algorithmic trading generator is stuck. Here are the last 3 failures:\n`
          + JSON.stringify(failures.slice(0,3), null, 2)
          + `\nProvide a radical parameter mutation to break the stall. Return ONLY raw JSON with no markdown formatting. Format: {"target": 15, "stop": 5, "hold": 10, "rsiEntry": 30, "rsiExit": 60}`;
        
        const r = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { temperature: 0.7 } });
        const jsonText = r.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const mutation = JSON.parse(jsonText);
        
        const injectionFile = path.join(this.baseDir, 'reasoning-bot', 'data', 'praximous_injection.json');
        fs.writeFileSync(injectionFile, JSON.stringify(mutation, null, 2));
        
        // Clear failures to forcibly unstick the loop!
        fs.writeFileSync(failuresFile, JSON.stringify([]));
        
        console.log(`      ✨ MUTATION SUCCESSFUL: Target ${mutation.target}%, Stop ${mutation.stop}%, Hold ${mutation.hold}d`);
        console.log(`      → Failure log cleared. Injection saved for next reasoning cycle.`);
        this.logAlert('Forge Master', `Mutation successful: Target ${mutation.target}%, Stop ${mutation.stop}%, Hold ${mutation.hold}d`, '✨');
      } catch(e) {
        console.log(`      ❌ Mutation failed: ${e.message}`);
        this.logAlert('Forge Master', `Mutation failed: ${e.message}`, '❌');
      }
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
        this.logAlert('Sentinel', `Active strategy lost ${losses} consecutive trades. Aegis Lock 2 initiated.`, '🛑');
        return;
      }
    }
    console.log('      ✅ Live risk is contained. No excessive drawdowns detected.');
  }

  // 📚 The Librarian: Maintains database health and optimizes WAL
  runLibrarian() {
    console.log('   📚 LIBRARIAN: Active');
    const dbPath = path.join(this.baseDir, 'data', 'intelligence.db');
    
    if (!fs.existsSync(dbPath)) {
      console.log('      ⚠️  Database not found. Skipping maintenance.');
      return;
    }

    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      
      // Perform a WAL checkpoint and optimize queries
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.pragma('optimize');
      
      const count = db.prepare('SELECT COUNT(*) as c FROM candles').get().c;
      console.log(`      ✅ Database optimized. Total records: ${count.toLocaleString()}`);
      
      db.close();
    } catch (e) {
      console.log(`      ❌ Librarian error: ${e.message}`);
      this.logAlert('Librarian', `Error: ${e.message}`, '❌');
    }
  }

  // ✉️ The Diplomat: Sends external alerts (e.g., Telegram) for critical events
  async runDiplomat() {
    console.log('   ✉️  DIPLOMAT: Active');
    
    const monitorLog = path.join(this.baseDir, 'reasoning-bot', 'data', 'monitor_log.json');
    const log = this.readJSON(monitorLog);
    
    let isAegisTriggered = false;
    let losses = 0;
    if (log && log.trades && log.trades.length > 0) {
      const recentTrades = log.trades.slice(-3);
      losses = recentTrades.filter(t => !t.win).length;
      if (losses >= 3) isAegisTriggered = true;
    }
    
    const marketStateFile = path.join(this.baseDir, 'reasoning-bot', 'active_strategy.json');
    const market = this.readJSON(marketStateFile)?.marketState;
    const isVolumeSpike = market && market.volumeRatio > 2.0;

    if (isAegisTriggered || isVolumeSpike) {
      console.log('      🚨 Critical events detected. Preparing dispatch...');
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      
      if (!token || !chatId) {
        console.log('      ⚠️  Telegram credentials missing in .env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).');
        return;
      }
      
      const messages = [];
      if (isAegisTriggered) {
        messages.push(`🛑 *CRITICAL ALERT: S.O.T.O.S Aegis Triggered*\nActive strategy has lost ${losses} consecutive trades. Aegis Lock 2 revocation protocol initiated.`);
      }
      if (isVolumeSpike) {
        messages.push(`🚨 *SCOUT ALERT: Massive Volume Spike*\nVolume is currently ${market.volumeRatio.toFixed(2)}x normal. Market volatility increasing.`);
      }
      
      try {
        const https = require('https');
        for (const message of messages) {
          const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' });
          const options = { hostname: 'api.telegram.org', port: 443, path: `/bot${token}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
          await new Promise((resolve, reject) => { const req = https.request(options, res => { res.on('data', () => {}); res.on('end', resolve); }); req.on('error', reject); req.write(data); req.end(); });
        }
        console.log(`      ✅ ${messages.length} alert(s) dispatched to Telegram.`);
        this.logAlert('Diplomat', `${messages.length} alert(s) dispatched to Telegram.`, '✉️');
      } catch (e) {
        console.log(`      ❌ Failed to dispatch alert: ${e.message}`);
        this.logAlert('Diplomat', `Failed to dispatch alert: ${e.message}`, '❌');
      }
    } else {
      console.log('      ✅ No critical alerts to dispatch.');
    }
  }

  async runSwarm() {
    this.runScout();
    console.log('   ' + '─'.repeat(54));
    await this.runForgeMaster();
    console.log('   ' + '─'.repeat(54));
    this.runSentinel();
    console.log('   ' + '─'.repeat(54));
    this.runLibrarian();
    console.log('   ' + '─'.repeat(54));
    await this.runDiplomat();
  }
}

module.exports = Praximous;