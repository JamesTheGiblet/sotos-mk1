#!/usr/bin/env node
const ReasoningBot = require('./index');

const args = process.argv.slice(2);
const command = args[0];

if (command === 'status') {
  const bot = new ReasoningBot();
  bot.start().then(() => {
    setTimeout(() => {
      console.log('\n' + '═'.repeat(60));
      console.log('🧠 REASONING BOT — System Status');
      console.log('═'.repeat(60));
      const status = bot.getStatus();
      console.log(JSON.stringify(status, null, 2).split('\n').map(l => '   ' + l).join('\n'));
      console.log('═'.repeat(60) + '\n');
      process.exit(0);
    }, 2000);
  }).catch(console.error);
} else if (command === 'once') {
  const bot = new ReasoningBot();
  bot.runOnce().catch(console.error);
} else if (command === 'help') {
  console.log('\n' + '═'.repeat(60));
  console.log('🧠 REASONING BOT — Market-Adaptive Strategy Engine');
  console.log('═'.repeat(60));
  console.log('   Commands:');
  console.log('     node cli.js           Start the reasoning daemon (default)');
  console.log('     node cli.js once      Run a single market analysis cycle');
  console.log('     node cli.js status    Show current bot status');
  console.log('     node cli.js help      Show this menu');
  console.log('\n   Examples:');
  console.log('     node cli.js once');
  console.log('     node cli.js status\n');
} else {
  const bot = new ReasoningBot();
  bot.start().catch(console.error);
}
