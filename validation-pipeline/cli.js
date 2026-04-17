const StrategyValidator = require('./strategy_validator');
const fs = require('fs');
const path = require('path');
const validator = new StrategyValidator();

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (command === 'test') {
    const strategy = {
      type: args[1] || 'consecutive_red',
      target: parseFloat(args[2]) || 2,
      stop: parseFloat(args[3]) || 1,
      hold: parseInt(args[4]) || 5,
      count: 4
    };
    const result = await validator.validateStrategy(strategy, 'Manual Test', true);
    
    // Save result to SCP
    const scpPath = path.join(process.env.HOME, 'cce', 'engines', 'generated', 'validation_result.json');
    fs.writeFileSync(scpPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      strategy: strategy,
      result: result
    }, null, 2));
    console.log(`\n📄 Result saved to: ${scpPath}`);
    
  } else if (command === 'validate-scp') {
    const scpPath = args[1];
    if (!scpPath) {
      console.log('Usage: node cli.js validate-scp <path-to-scp.json>');
      return;
    }
    const scp = JSON.parse(fs.readFileSync(scpPath, 'utf8'));
    const strategy = scp.strategy || scp;
    const result = await validator.validateStrategy(strategy, scp.name || 'SCP Strategy', true);
    
    // Update SCP with validation result
    scp.validation = result;
    scp.status = result.passed ? 'VALIDATED' : 'UNDER_REVIEW';
    fs.writeFileSync(scpPath, JSON.stringify(scp, null, 2));
    console.log(`\n📄 Updated SCP with validation result`);
    
  } else {
    console.log(`
Strategy Validation Pipeline - Commands:
  node cli.js test <type> <target> <stop> <hold>  - Test with auto-optimization
  node cli.js validate-scp <path>                 - Validate existing SCP

Example:
  node cli.js test consecutive_red 2 1 5
`);
  }
}

main().catch(console.error);
