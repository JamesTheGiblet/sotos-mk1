#!/usr/bin/env node
/**
 * CertiScope — Web Credibility Scoring
 * Part of the Adaptive Intelligence Platform
 * License: MIT
 */

const https = require('https');
const http = require('http');

class CertiScope {
  constructor() {
    this.scores = new Map();
    this.results = [];
  }

  async checkSSL(hostname) {
    return new Promise((resolve) => {
      const options = {
        hostname: hostname,
        port: 443,
        method: 'HEAD',
        rejectUnauthorized: true,
        timeout: 5000
      };
      
      const req = https.request(options, (res) => {
        const cert = res.socket.getPeerCertificate();
        const isValid = cert && Object.keys(cert).length > 0;
        const expires = cert.valid_to ? new Date(cert.valid_to) : null;
        const daysRemaining = expires ? Math.floor((expires - new Date()) / (1000 * 60 * 60 * 24)) : 0;
        
        resolve({
          valid: isValid,
          issuer: cert.issuer?.CN || 'Unknown',
          expires: expires?.toISOString() || 'Unknown',
          daysRemaining: daysRemaining,
          score: isValid ? (daysRemaining > 30 ? 100 : daysRemaining > 7 ? 70 : 40) : 0
        });
      });
      
      req.on('error', () => resolve({ valid: false, score: 0, error: 'Connection failed' }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ valid: false, score: 0, error: 'Timeout' });
      });
      req.end();
    });
  }

  async checkEndpoint(url, expectedStatus = 200) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const protocol = url.startsWith('https') ? https : http;
      
      const req = protocol.get(url, (res) => {
        const responseTime = Date.now() - startTime;
        let data = '';
        
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const isValid = res.statusCode === expectedStatus;
          resolve({
            url,
            statusCode: res.statusCode,
            expected: expectedStatus,
            valid: isValid,
            responseTime,
            score: isValid ? (responseTime < 500 ? 100 : responseTime < 1000 ? 80 : 60) : 0,
            dataPreview: data.slice(0, 200)
          });
        });
      });
      
      req.on('error', (err) => {
        resolve({ url, valid: false, score: 0, error: err.message });
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ url, valid: false, score: 0, error: 'Timeout' });
      });
    });
  }

  checkFreshness(data, expectedIntervalHours = 24) {
    if (!data || !data.timestamp) {
      return { fresh: false, age: null, score: 0, reason: 'No timestamp' };
    }
    
    const lastUpdate = new Date(data.timestamp);
    const now = new Date();
    const ageHours = (now - lastUpdate) / (1000 * 60 * 60);
    const isFresh = ageHours <= expectedIntervalHours;
    
    let score = 100;
    if (ageHours > expectedIntervalHours * 2) score = 30;
    else if (ageHours > expectedIntervalHours) score = 60;
    else if (ageHours > expectedIntervalHours * 0.5) score = 80;
    
    return {
      fresh: isFresh,
      ageHours,
      expectedInterval: expectedIntervalHours,
      score,
      lastUpdate: lastUpdate.toISOString()
    };
  }

  calculateCredibility(results) {
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const result of results) {
      let weight = 0;
      if (result.type === 'ssl') weight = 0.3;
      if (result.type === 'endpoint') weight = 0.4;
      if (result.type === 'freshness') weight = 0.3;
      
      totalScore += (result.score / 100) * weight;
      totalWeight += weight;
    }
    
    let percentage = totalWeight > 0 ? (totalScore / totalWeight) * 100 : 0;
    percentage = Math.min(100, percentage);
    
    const grade = percentage >= 80 ? 'A' : percentage >= 60 ? 'B' : percentage >= 40 ? 'C' : 'F';
    const trustworthy = percentage >= 70;
    
    return {
      totalScore: percentage,
      grade,
      trustworthy,
      recommendation: trustworthy ? 'Trustworthy - Safe to use' : 'High risk - Verify manually'
    };
  }

  async validateKrakenAPI() {
    console.log('🔍 Validating Kraken API endpoints...');
    
    const endpoints = [
      { url: 'https://api.kraken.com/0/public/Time', expected: 200, name: 'Time API' },
      { url: 'https://api.kraken.com/0/public/Assets', expected: 200, name: 'Assets API' },
      { url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD', expected: 200, name: 'Ticker API' }
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      const result = await this.checkEndpoint(endpoint.url, endpoint.expected);
      result.type = 'endpoint';
      result.name = endpoint.name;
      results.push(result);
      console.log(`  ${result.name}: ${result.valid ? '✅' : '❌'} (${result.responseTime || 'N/A'}ms)`);
    }
    
    const sslResult = await this.checkSSL('api.kraken.com');
    sslResult.type = 'ssl';
    results.push(sslResult);
    console.log(`  SSL Certificate: ${sslResult.valid ? '✅' : '❌'} (${sslResult.daysRemaining} days left)`);
    
    const credibility = this.calculateCredibility(results);
    console.log(`\n📊 Kraken API Credibility: ${credibility.totalScore.toFixed(1)}% (Grade: ${credibility.grade})`);
    console.log(`  ${credibility.recommendation}`);
    
    return { results, credibility };
  }

  validateMarketData(marketState) {
    console.log('\n🔍 Validating market data freshness...');
    
    const freshness = this.checkFreshness(marketState, 1);
    freshness.type = 'freshness';
    
    console.log(`  Last update: ${freshness.lastUpdate}`);
    console.log(`  Age: ${freshness.ageHours.toFixed(1)} hours`);
    console.log(`  Freshness score: ${freshness.score}%`);
    
    return freshness;
  }
}

module.exports = CertiScope;
