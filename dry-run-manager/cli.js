cat > cli.js << 'EOF'
const DryRunManager = require('./dry_run_manager');
const manager = new DryRunManager();

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'status':
    manager.printStatus();
    break;
    
  case 'add':
    const strategyName = args[1];
    const strategyPath = args[2];
    if (strategyName && strategyPath) {
      manager.addToDryRun(strategyName, strategyPath);
      manager.startDryRun(strategyName);
    } else {
      console.log('Usage: node cli.js add <strategy-name> <strategy-path>');
    }
    break;
    
  case 'start':
    manager.startDryRun(args[1]);
    break;
    
  case 'stop':
    manager.stopDryRun(args[1]);
    break;
    
  case 'promote':
    const ready = manager.getReadyStrategies();
    if (ready.length === 0) {
      console.log('No strategies ready for promotion yet.');
    } else {
      console.log('Ready strategies:');
      ready.forEach((s, i) => console.log(`  ${i+1}. ${s.name} (${s.dryRunDays}/30 days)`));
      if (args[1]) {
        manager.promoteToLive(args[1]);
      } else {
        console.log('\nUsage: node cli.js promote <strategy-name>');
      }
    }
    break;
    
  case 'auto':
    manager.run();
    break;
    
  default:
    console.log(`
Dry Run Manager - Commands:
  node cli.js status              - Show dry run status
  node cli.js add <name> <path>   - Add strategy to dry run
  node cli.js start <name>        - Start dry run
  node cli.js stop <name>         - Stop dry run
  node cli.js promote <name>      - Promote to live (after 30 days)
  node cli.js auto                - Auto-add and update all
`);
}
EOF
