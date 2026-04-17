const ReasoningBotStorage = require('./storage');

async function test() {
  const storage = new ReasoningBotStorage();
  await storage.init();

  const testState = {
    timestamp: new Date().toISOString(),
    regime: 'TEST_RANGING',
    phase: 'TEST_ACCUMULATION',
    sentiment: 'TEST_NEUTRAL',
    volatility: 1.5,
    trend: 1.2,
    volumeRatio: 0.8,
    btcPrice: 70000
  };

  const id = storage.saveMarketState(testState);
  console.log('Returned ID:', id);

  const stats = storage.getStats();
  console.log('Stats after save:', stats);

  storage.close();
}

test().catch(console.error);
