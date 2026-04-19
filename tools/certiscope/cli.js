#!/usr/bin/env node
const CertiScope = require('./index');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const certiscope = new CertiScope();

  if (command === 'kraken') {
    console.log('\n' + '═'.repeat(60));
    console.log('🔒 CERTISCOPE — Kraken API Validation');
    console.log('═'.repeat(60) + '\n');
    
    const result = await certiscope.validateKrakenAPI();
    
    console.log('\n' + '═'.repeat(60));
    
  } else if (command === 'market') {
    console.log('\n' + '═'.repeat(60));
    console.log('🔒 CERTISCOPE — Market Data Validation');
    console.log('═'.repeat(60) + '\n');
    
    const marketStateFile = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/active_strategy.json');
    if (fs.existsSync(marketStateFile)) {
      const marketState = JSON.parse(fs.readFileSync(marketStateFile, 'utf8'));
      const freshness = certiscope.validateMarketData(marketState);
      console.log(`\n   ✅ Market credibility: ${freshness.score}%`);
    } else {
      console.log('   ❌ Market state file not found');
    }
    
  } else if (command === 'all') {
    console.log('\n' + '═'.repeat(60));
    console.log('🔒 CERTISCOPE — Full System Validation');
    console.log('═'.repeat(60) + '\n');
    
    await certiscope.validateKrakenAPI();
    
    const marketStateFile = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/active_strategy.json');
    if (fs.existsSync(marketStateFile)) {
      const marketState = JSON.parse(fs.readFileSync(marketStateFile, 'utf8'));
      const freshness = certiscope.validateMarketData(marketState);
      console.log(`\n   ✅ Market credibility: ${freshness.score}%`);
    }
    
  } else {
    console.log('\n' + '═'.repeat(60));
    console.log('🔒 CERTISCOPE — Web Credibility Scoring');
    console.log('═'.repeat(60));
    console.log('   Commands:');
    console.log('     node cli.js kraken    Validate Kraken API endpoints');
    console.log('     node cli.js market    Validate market data freshness');
    console.log('     node cli.js all       Run all validations');
    console.log('\n   Examples:');
    console.log('     node cli.js kraken');
    console.log('     node cli.js market');
    console.log('     node cli.js all\n');
  }
}

main().catch(console.error);
