#!/usr/bin/env node
const MarkFlow = require('./index');
const path = require('path');
const markflow = new MarkFlow();
const args = process.argv.slice(2);
const command = args[0];

if (command === 'readme') {
  const capsulePath = args[1];
  if (!capsulePath) {
    console.log('Usage: node cli.js readme <capsule-path>');
    process.exit(1);
  }
  
  const result = markflow.generateStrategyReadme(capsulePath);
  if (result.success) {
    console.log(`✅ README generated: ${result.path}`);
  } else {
    console.log(`❌ Failed: ${result.error}`);
  }
  
} else if (command === 'compliance') {
  const result = markflow.generateComplianceReport();
  if (result.success) {
    console.log(`✅ Compliance report generated: ${result.path}`);
  } else {
    console.log(`❌ Failed: ${result.error}`);
  }
  
} else if (command === 'dashboard') {
  const result = markflow.generateStatusDashboard();
  if (result.success) {
    console.log(`✅ Dashboard generated: ${result.path}`);
  } else {
    console.log(`❌ Failed: ${result.error}`);
  }
  
} else if (command === 'all') {
  console.log('📝 Generating all documentation...');
  
  const defaultCapsule = path.join(process.env.HOME, 'cce/engines/scp/consecutive_red-2026-04-15-xf18');
  const capsulePath = args[1] || defaultCapsule;
  
  const readme = markflow.generateStrategyReadme(capsulePath);
  if (readme.success) console.log(`  ✅ README: ${readme.path}`);
  
  const compliance = markflow.generateComplianceReport();
  if (compliance.success) console.log(`  ✅ Compliance: ${compliance.path}`);
  
  const dashboard = markflow.generateStatusDashboard();
  if (dashboard.success) console.log(`  ✅ Dashboard: ${dashboard.path}`);
  
  console.log('\n📂 Documentation saved to: ~/kraken-intelligence/docs/');
  
} else {
  console.log(`
MarkFlow — Intelligent Markdown Editor

Commands:
  node cli.js readme <capsule-path>     Generate strategy README
  node cli.js compliance                Generate compliance report
  node cli.js dashboard                 Generate system dashboard
  node cli.js all [capsule-path]        Generate all documentation

Examples:
  node cli.js readme ~/cce/engines/scp/consecutive_red-2026-04-15-xf18
  node cli.js compliance
  node cli.js dashboard
  node cli.js all
`);
}
