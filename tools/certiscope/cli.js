#!/usr/bin/env node
const CertiScope = require('./index');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const certiscope = new CertiScope();

  if (command === 'kraken') {
    console.log('════════════════════════════════════════════════════════');
    console.log('🔒 CERTISCOPE - Kraken API Validation');
    console.log('════════════════════════════════════════════════════════\n');
    
    const result = await certiscope.validateKrakenAPI();
    
    console.log('\n════════════════════════════════════════════════════════');
    
  } else if (command === 'market') {
    console.log('════════════════════════════════════════════════════════');
    console.log('🔒 CERTISCOPE - Market Data Validation');
    console.log('════════════════════════════════════════════════════════\n');
    
    const marketStateFile = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/active_strategy.json');
    if (fs.existsSync(marketStateFile)) {
      const marketState = JSON.parse(fs.readFileSync(marketStateFile, 'utf8'));
      const freshness = certiscope.validateMarketData(marketState);
      console.log(`\n  Market credibility: ${freshness.score}%`);
    } else {
      console.log('❌ Market state file not found');
    }
    
  } else if (command === 'all') {
    console.log('════════════════════════════════════════════════════════');
    console.log('🔒 CERTISCOPE - Full System Validation');
    console.log('════════════════════════════════════════════════════════\n');
    
    await certiscope.validateKrakenAPI();
    
    const marketStateFile = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/active_strategy.json');
    if (fs.existsSync(marketStateFile)) {
      const marketState = JSON.parse(fs.readFileSync(marketStateFile, 'utf8'));
      const freshness = certiscope.validateMarketData(marketState);
      console.log(`\n  Market credibility: ${freshness.score}%`);
    }
    
  } else {
    console.log(`
CertiScope — Web Credibility Scoring

Commands:
  node cli.js kraken    Validate Kraken API endpoints
  node cli.js market    Validate market data freshness
  node cli.js all       Run all validations

Examples:
  node cli.js kraken
  node cli.js market
  node cli.js all
`);
  }
}

main().catch(console.error);
