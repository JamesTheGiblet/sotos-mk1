#!/usr/bin/env node
/**
 * Aegis — Compliance Framework
 * Purpose-built for Kraken Intelligence
 * 
 * Tracks:
 * - 30-day dry run compliance
 * - Strategy validation records
 * - Three locks status
 * - Audit trail for all actions
 */

const fs = require('fs');
const path = require('path');

class Aegis {
  constructor() {
    this.complianceDir = path.join(process.env.HOME, 'kraken-intelligence', 'compliance');
    this.auditLog = path.join(this.complianceDir, 'audit.log');
    this.locksFile = path.join(this.complianceDir, 'locks.json');
    this.strategiesFile = path.join(this.complianceDir, 'strategies.json');
    this.init();
  }

  init() {
    if (!fs.existsSync(this.complianceDir)) {
      fs.mkdirSync(this.complianceDir, { recursive: true });
    }
    if (!fs.existsSync(this.locksFile)) {
      fs.writeFileSync(this.locksFile, JSON.stringify({
        lock1_dry_run_days: 0,
        lock1_complete: false,
        lock2_validation_passed: false,
        lock3_api_key_present: false,
        overall_status: 'LOCKED'
      }, null, 2));
    }
    if (!fs.existsSync(this.strategiesFile)) {
      fs.writeFileSync(this.strategiesFile, JSON.stringify([], null, 2));
    }
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}`;
    console.log(logEntry);
    fs.appendFileSync(this.auditLog, logEntry + '\n');
  }

  updateDryRunDays(days) {
    const locks = JSON.parse(fs.readFileSync(this.locksFile, 'utf8'));
    locks.lock1_dry_run_days = days;
    locks.lock1_complete = days >= 30;
    if (days >= 30) {
      this.log(`Lock 1 complete: ${days}/30 days dry run`, 'COMPLIANCE');
    } else {
      this.log(`Lock 1 progress: ${days}/30 days dry run`, 'PROGRESS');
    }
    fs.writeFileSync(this.locksFile, JSON.stringify(locks, null, 2));
    return locks.lock1_complete;
  }

  recordValidation(strategyId, validationResult) {
    const strategies = JSON.parse(fs.readFileSync(this.strategiesFile, 'utf8'));
    
    let passed = false;
    let backtestWinRate = null;
    let forwardWinRate = null;
    let score = 0;
    let grade = 'F';
    let degradation = null;
    
    if (validationResult && validationResult.result) {
      const result = validationResult.result;
      passed = result.passed === true;
      
      if (result.optimalResult) {
        backtestWinRate = result.optimalResult.backtest?.winRate;
        forwardWinRate = result.optimalResult.forward?.winRate;
        score = result.optimalResult.score || 0;
        
        if (score >= 70) grade = 'A';
        else if (score >= 60) grade = 'B';
        else if (score >= 50) grade = 'C';
        else grade = 'F';
        
        if (backtestWinRate && forwardWinRate) {
          degradation = ((backtestWinRate - forwardWinRate) / backtestWinRate) * 100;
          degradation = Math.max(0, degradation);
        }
      }
    } else if (validationResult && validationResult.passed !== undefined) {
      passed = validationResult.passed;
      backtestWinRate = validationResult.backtest?.winRate;
      forwardWinRate = validationResult.forward?.winRate;
      score = validationResult.score || 0;
      grade = validationResult.grade || 'F';
      degradation = validationResult.degradation;
    }
    
    const record = {
      strategyId: strategyId,
      timestamp: new Date().toISOString(),
      passed: passed,
      backtestWinRate: backtestWinRate,
      forwardWinRate: forwardWinRate,
      score: score,
      grade: grade,
      degradation: degradation
    };
    
    strategies.push(record);
    fs.writeFileSync(this.strategiesFile, JSON.stringify(strategies, null, 2));
    
    if (passed) {
      const locks = JSON.parse(fs.readFileSync(this.locksFile, 'utf8'));
      locks.lock2_validation_passed = true;
      fs.writeFileSync(this.locksFile, JSON.stringify(locks, null, 2));
      this.log(`Lock 2 complete: Strategy ${strategyId} validated (Grade: ${grade})`, 'COMPLIANCE');
    }
    
    return record;
  }

  setApiKeyPresent(present) {
    const locks = JSON.parse(fs.readFileSync(this.locksFile, 'utf8'));
    locks.lock3_api_key_present = present;
    if (present) {
      this.log('Lock 3 complete: API key added', 'COMPLIANCE');
    }
    fs.writeFileSync(this.locksFile, JSON.stringify(locks, null, 2));
  }

  getComplianceStatus() {
    const locks = JSON.parse(fs.readFileSync(this.locksFile, 'utf8'));
    const allLocksOpen = locks.lock1_complete &&
                         locks.lock2_validation_passed &&
                         locks.lock3_api_key_present;
    
    // Auto-update overall status
    if (allLocksOpen && locks.overall_status !== 'READY_FOR_LIVE') {
      locks.overall_status = 'READY_FOR_LIVE';
      fs.writeFileSync(this.locksFile, JSON.stringify(locks, null, 2));
    }
    
    return {
      lock1: {
        name: '30-Day Dry Run',
        required: 30,
        current: locks.lock1_dry_run_days,
        complete: locks.lock1_complete,
        progress: `${locks.lock1_dry_run_days}/30`
      },
      lock2: {
        name: 'Strategy Validation',
        required: true,
        current: locks.lock2_validation_passed,
        complete: locks.lock2_validation_passed
      },
      lock3: {
        name: 'API Key Present',
        required: true,
        current: locks.lock3_api_key_present,
        complete: locks.lock3_api_key_present
      },
      overall: {
        status: locks.overall_status,
        ready: allLocksOpen
      }
    };
  }

  generateReport() {
    const status = this.getComplianceStatus();
    const strategies = JSON.parse(fs.readFileSync(this.strategiesFile, 'utf8'));
    const lastStrategies = strategies.slice(-5);
    
    let report = '\n' + '═'.repeat(70) + '\n';
    report += '📋 AEGIS COMPLIANCE REPORT\n';
    report += '═'.repeat(70) + '\n\n';
    
    report += '🔒 THREE LOCKS STATUS:\n';
    report += '───────────────────────────────────────────────────────────────\n';
    report += `  Lock 1 (30-Day Dry Run): ${status.lock1.progress} days\n`;
    report += `  Lock 2 (Validation):     ${status.lock2.complete ? '✅ PASSED' : '⏳ PENDING'}\n`;
    report += `  Lock 3 (API Key):        ${status.lock3.complete ? '✅ PRESENT' : '⏳ MISSING'}\n`;
    report += `  Overall:                 ${status.overall.status}\n\n`;
    
    if (lastStrategies.length > 0) {
      report += '📊 RECENT VALIDATIONS:\n';
      report += '───────────────────────────────────────────────────────────────\n';
      for (const s of lastStrategies) {
        report += `  ${s.timestamp.split('T')[0]} | ${s.strategyId} | Grade: ${s.grade} | ${s.passed ? '✅ PASS' : '❌ FAIL'}\n`;
      }
      report += '\n';
    }
    
    report += '📜 AUDIT TRAIL (last 5 entries):\n';
    report += '───────────────────────────────────────────────────────────────\n';
    if (fs.existsSync(this.auditLog)) {
      const logs = fs.readFileSync(this.auditLog, 'utf8').trim().split('\n').slice(-5);
      for (const log of logs) {
        report += `  ${log}\n`;
      }
    }
    
    report += '\n' + '═'.repeat(70) + '\n';
    report += `Report generated: ${new Date().toISOString()}\n`;
    report += '═'.repeat(70) + '\n';
    
    const reportPath = path.join(this.complianceDir, `compliance_${new Date().toISOString().split('T')[0]}.txt`);
    fs.writeFileSync(reportPath, report);
    
    return { report, reportPath };
  }

  isReadyForLive() {
    const status = this.getComplianceStatus();
    const allLocksOpen = status.lock1.complete && status.lock2.complete && status.lock3.complete;
    
    if (allLocksOpen) {
      this.log('All three locks open — Ready for live trading', 'COMPLIANCE');
    } else {
      const missing = [];
      if (!status.lock1.complete) missing.push(`Lock 1 (${status.lock1.progress} days)`);
      if (!status.lock2.complete) missing.push('Lock 2 (validation)');
      if (!status.lock3.complete) missing.push('Lock 3 (API key)');
      this.log(`Cannot go live: Missing ${missing.join(', ')}`, 'WARNING');
    }
    
    return allLocksOpen;
  }
}

module.exports = Aegis;
