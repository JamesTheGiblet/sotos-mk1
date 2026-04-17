#!/usr/bin/env node
/**
 * Whisper — Native Security Scanner
 * Purpose-built for Kraken Intelligence
 */

const fs = require('fs');
const path = require('path');

class Whisper {
  constructor() {
    this.severity = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
      INFO: 0
    };
    
    this.patterns = [
      // API Keys (CRITICAL)
      { pattern: /['"](kraken|api|secret|key)['"]\s*:\s*['"][a-zA-Z0-9]{20,}/i, severity: 'CRITICAL', name: 'hardcoded_api_key' },
      { pattern: /API_KEY\s*=\s*['"][a-zA-Z0-9]{10,}['"]/, severity: 'CRITICAL', name: 'api_key_assignment' },
      { pattern: /SECRET_KEY\s*=\s*['"][a-zA-Z0-9]{10,}['"]/, severity: 'CRITICAL', name: 'secret_key_assignment' },
      { pattern: /TOKEN\s*=\s*['"][a-zA-Z0-9]{20,}['"]/, severity: 'HIGH', name: 'token_assignment' },
      { pattern: /['"](password|passwd)['"]\s*:\s*['"][^'"]{4,}['"]/, severity: 'HIGH', name: 'password_in_code' },
      
      // Dangerous system commands (not SQL)
      { pattern: /child_process\.exec\(/, severity: 'HIGH', name: 'child_process_exec' },
      { pattern: /require\(['"]child_process['"]\)/, severity: 'MEDIUM', name: 'child_process_require' },
      { pattern: /eval\s*\(/, severity: 'HIGH', name: 'eval_usage' },
      { pattern: /Function\(/, severity: 'HIGH', name: 'function_constructor' },
      
      // SQL injection (db.exec is safe, it's SQLite method)
      // Only flag if it's concatenating user input
      { pattern: /db\.exec\(['"]\s*\+\s*/, severity: 'MEDIUM', name: 'sql_injection_risk' },
      
      // Crypto trading specific
      { pattern: /process\.env\.[A-Z_]+_KEY/, severity: 'INFO', name: 'env_key_reference' },
      { pattern: /\.env/, severity: 'LOW', name: 'env_file_reference' },
      { pattern: /console\.log\(.*key/i, severity: 'MEDIUM', name: 'key_logging' },
      { pattern: /console\.log\(.*secret/i, severity: 'MEDIUM', name: 'secret_logging' },
      
      // File system
      { pattern: /fs\.readFileSync\(['"].*\.key['"]/, severity: 'HIGH', name: 'key_file_read' },
      { pattern: /require\(['"]\.\.\/\.env['"]/, severity: 'LOW', name: 'dotenv_require' },
      
      // Hardcoded credentials
      { pattern: /https?:\/\/[^\/\s]+:[^\/\s]+@/, severity: 'CRITICAL', name: 'url_with_credentials' }
    ];
    
    this.results = [];
  }

  scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const findings = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of this.patterns) {
        if (p.pattern.test(line)) {
          findings.push({
            line: i + 1,
            column: line.search(p.pattern) + 1,
            pattern: p.name,
            severity: p.severity,
            snippet: line.trim().slice(0, 80)
          });
        }
      }
    }
    
    return findings;
  }

  scanDirectory(dirPath, relativePath = '') {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const relPath = relativePath ? path.join(relativePath, file) : file;
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (file === 'node_modules' || file === '.git') continue;
        this.scanDirectory(fullPath, relPath);
      } else if (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.env')) {
        const findings = this.scanFile(fullPath);
        if (findings.length > 0) {
          this.results.push({
            file: relPath,
            findings: findings
          });
        }
      }
    }
  }

  scan(paths) {
    this.results = [];
    for (const p of paths) {
      const fullPath = path.resolve(process.env.HOME, p);
      if (fs.existsSync(fullPath)) {
        this.scanDirectory(fullPath);
      } else {
        console.log(`⚠️ Path not found: ${p}`);
      }
    }
    return this.results;
  }

  getSummary() {
    let critical = 0, high = 0, medium = 0, low = 0, info = 0;
    
    for (const result of this.results) {
      for (const finding of result.findings) {
        switch (finding.severity) {
          case 'CRITICAL': critical++; break;
          case 'HIGH': high++; break;
          case 'MEDIUM': medium++; break;
          case 'LOW': low++; break;
          case 'INFO': info++; break;
        }
      }
    }
    
    return { critical, high, medium, low, info, total: critical + high + medium + low + info };
  }

  printReport() {
    const summary = this.getSummary();
    
    console.log('\n' + '═'.repeat(70));
    console.log('🔒 WHISPER SECURITY SCAN REPORT');
    console.log('═'.repeat(70));
    console.log(`  Critical: ${summary.critical}`);
    console.log(`  High:     ${summary.high}`);
    console.log(`  Medium:   ${summary.medium}`);
    console.log(`  Low:      ${summary.low}`);
    console.log(`  Info:     ${summary.info}`);
    console.log(`  Total:    ${summary.total}`);
    console.log('═'.repeat(70));
    
    if (summary.critical > 0) {
      console.log('\n❌ CRITICAL ISSUES FOUND:');
      for (const result of this.results) {
        for (const finding of result.findings) {
          if (finding.severity === 'CRITICAL') {
            console.log(`  ${finding.severity}: ${result.file} (line ${finding.line})`);
            console.log(`    → ${finding.pattern}`);
            console.log(`    → ${finding.snippet}`);
          }
        }
      }
      console.log('\n⚠️  CRITICAL issues must be fixed before live deployment');
      return false;
      
    } else if (summary.high > 0) {
      console.log('\n🟡 HIGH SEVERITY ISSUES:');
      for (const result of this.results) {
        for (const finding of result.findings) {
          if (finding.severity === 'HIGH') {
            console.log(`  ${finding.severity}: ${result.file} (line ${finding.line})`);
            console.log(`    → ${finding.pattern}`);
            console.log(`    → ${finding.snippet}`);
          }
        }
      }
      console.log('\n⚠️  Review HIGH severity issues before live deployment');
      return true; // Passes but with warnings
      
    } else if (summary.medium > 0) {
      console.log('\n📋 MEDIUM SEVERITY ISSUES — Review recommended');
      return true;
      
    } else {
      console.log('\n✅ No security issues found');
      return true;
    }
  }
}

module.exports = Whisper;
