#!/usr/bin/env node
const Aegis = require('./index');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

const aegis = new Aegis();

if (command === 'status') {
  const status = aegis.getComplianceStatus();
  console.log('\n' + '═'.repeat(70));
  console.log('🔒 AEGIS COMPLIANCE STATUS');
  console.log('═'.repeat(70));
  console.log(`  Lock 1 (30-Day Dry Run): ${status.lock1.progress} days`);
  console.log(`  Lock 2 (Validation):     ${status.lock2.complete ? '✅ PASSED' : '⏳ PENDING'}`);
  console.log(`  Lock 3 (API Key):        ${status.lock3.complete ? '✅ PRESENT' : '⏳ MISSING'}`);
  console.log(`  Overall:                 ${status.overall.status}`);
  console.log('═'.repeat(70));

} else if (command === 'report') {
  const { report, reportPath } = aegis.generateReport();
  console.log(report);
  console.log(`📄 Report saved: ${reportPath}`);

} else if (command === 'ready') {
  const ready = aegis.isReadyForLive();
  if (ready) {
    console.log('\n✅ All three locks are open! Ready for live deployment.');
  } else {
    console.log('\n❌ Not ready for live deployment.');
    console.log('   Run `node cli.js status` to see what\'s missing.');
  }

} else if (command === 'record') {
  const strategyId = args[1];
  const validationFile = args[2];
  if (strategyId && validationFile && fs.existsSync(validationFile)) {
    const validation = JSON.parse(fs.readFileSync(validationFile, 'utf8'));
    aegis.recordValidation(strategyId, validation);
    console.log(`✅ Recorded validation for ${strategyId}`);
  } else {
    console.log('Usage: node cli.js record <strategy-id> <validation-file>');
  }

} else if (command === 'days') {
  const days = parseInt(args[1]);
  if (!isNaN(days)) {
    aegis.updateDryRunDays(days);
    console.log(`✅ Updated dry run days: ${days}/30`);
  } else {
    console.log('Usage: node cli.js days <number>');
  }

} else if (command === 'apikey') {
  const present = args[1] === 'true';
  aegis.setApiKeyPresent(present);
  console.log(`✅ API key status set to: ${present ? 'PRESENT' : 'MISSING'}`);

} else {
  console.log(`
Aegis — Compliance Framework for Kraken Intelligence

Commands:
  node cli.js status              Show compliance status
  node cli.js report              Generate compliance report
  node cli.js ready               Check if ready for live trading
  node cli.js days <number>       Update dry run days (Lock 1)
  node cli.js apikey <true/false> Set API key status (Lock 3)
  node cli.js record <id> <file>  Record strategy validation (Lock 2)

Examples:
  node cli.js status
  node cli.js days 15
  node cli.js apikey true
  node cli.js ready
`);
}
