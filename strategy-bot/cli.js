const StrategyBot = require('./index');
const args = process.argv.slice(2);
const bot = new StrategyBot();

if (args[0] === 'status') {
  const history = bot.getHistory();
  console.log(JSON.stringify(history, null, 2));
} else if (args[0] === 'generate') {
  const marketState = {
    regime: args[1] || 'RANGING',
    phase: args[2] || 'ACCUMULATION',
    sentiment: args[3] || 'NEUTRAL',
    volatility: parseFloat(args[4]) || 1.5,
    trend: parseFloat(args[5]) || 0,
    volumeRatio: parseFloat(args[6]) || 1,
    btcPrice: parseFloat(args[7]) || 70000
  };
  bot.generateStrategy(marketState);
} else {
  bot.start().catch(console.error);
}
