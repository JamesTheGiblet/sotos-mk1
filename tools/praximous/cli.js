#!/usr/bin/env node
const Praximous = require('./index');
const args = process.argv.slice(2);
const command = args[0];

const swarm = new Praximous();

if (!command || command === 'run') {
  console.log('\n' + '═'.repeat(60));
  console.log('🤖 PRAXIMOUS — Proactive AI Agent Swarm');
  console.log('═'.repeat(60) + '\n');
  
  swarm.runSwarm().then(() => {
    console.log('\n' + '═'.repeat(60) + '\n');
  });
} else {
  console.log('\n' + '═'.repeat(60));
  console.log('🤖 PRAXIMOUS — Proactive AI Agent Swarm');
  console.log('═'.repeat(60));
  console.log('   Commands:');
  console.log('     node cli.js        Execute full agent swarm analysis (default)');
  console.log('     node cli.js help   Show this menu');
  console.log('\n   Examples:');
  console.log('     node cli.js\n');
}