const ReasoningBot = require('./index');

const args = process.argv.slice(2);
const command = args[0];

if (command === 'status') {
  const bot = new ReasoningBot();
  bot.start().then(() => {
    setTimeout(() => {
      const status = bot.getStatus();
      console.log(JSON.stringify(status, null, 2));
      process.exit(0);
    }, 2000);
  }).catch(console.error);
} else if (command === 'once') {
  const bot = new ReasoningBot();
  bot.runOnce().catch(console.error);
} else {
  const bot = new ReasoningBot();
  bot.start().catch(console.error);
}
