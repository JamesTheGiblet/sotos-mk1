#!/usr/bin/env node
'use strict';

/**
 * GENETIC DISCOVERY ENGINE v3.1
 * Adjusted parameters for better convergence:
 * - Lower EXPECTANCY_MIN to 0.2 (more inclusive)
 * - Increased POP_SIZE to 300
 * - Increased GENERATIONS to 200
 * - Lower MIN_TRADES to 5 for validation period
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const O_DIR = path.join(__dirname, '../strategies/genetic');
if (!fs.existsSync(O_DIR)) fs.mkdirSync(O_DIR, { recursive: true });

// ----------------------------------------------------------------------
// CONFIG - ADJUSTED
// ----------------------------------------------------------------------
const COSTS = { entry: 0.0015, exit: 0.0015 };
const MIN_TRADES = 5;                    // LOWERED from 8
const EXPECTANCY_MIN = 0.2;              // LOWERED from 0.3
const POP_SIZE = 300;                    // INCREASED from 200
const GENERATIONS = 200;                 // INCREASED from 100
const ELITE = 0.1;
const INIT_MUTATION_RATE = 0.35;
const FINAL_MUTATION_RATE = 0.08;
const STAGNATION_LIMIT = 20;
const INJECTION = 0.2;
const MONTE_CARLO_SHUFFLES = 500;        // LOWERED for speed
const MONTE_CARLO_WINDOW = 10;
const MONTE_CARLO_PROFIT_RATIO = 0.4;    // LOWERED from 0.5

// ----------------------------------------------------------------------
// MARKET PHASE DETECTION
// ----------------------------------------------------------------------
const PHASE = { ACCUMULATION: 0, MARKUP: 1, DISTRIBUTION: 2, MARKDOWN: 3 };

function detectPhase(candles, idx, lookback = 20) {
  if (idx < lookback) return PHASE.ACCUMULATION;
  const slice = candles.slice(idx - lookback, idx + 1);
  const prices = slice.map(c => c.close);
  const vols = slice.map(c => c.volume);
  const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const trend = (prices[prices.length - 1] - prices[0]) / prices[0];
  const volMean = vols.reduce((a, b) => a + b, 0) / vols.length;
  const volRatio = vols[vols.length - 1] / volMean;
  const volatility = Math.sqrt(prices.map(p => Math.pow(p - meanPrice, 2)).reduce((a, b) => a + b, 0) / prices.length) / meanPrice;

  if (trend > 0.05 && volRatio > 1.2) return PHASE.MARKUP;
  if (trend < -0.05 && volRatio > 1.2) return PHASE.MARKDOWN;
  if (volRatio > 1.5 && volatility > 0.03) return PHASE.DISTRIBUTION;
  return PHASE.ACCUMULATION;
}

// ----------------------------------------------------------------------
// BACKTEST ENGINE
// ----------------------------------------------------------------------
function backtest(candles, strategy) {
  let capital = 100;
  let position = null;
  let trades = [];
  let consecutiveRed = 0;
  let consecutiveGreen = 0;
  const phaseFilter = strategy.phaseFilter;

  for (let i = 30; i < candles.length; i++) {
    const c = candles[i];
    const phase = detectPhase(candles, i, strategy.phaseLookback || 20);

    if (c.close < c.open) { consecutiveRed++; consecutiveGreen = 0; }
    else { consecutiveGreen++; consecutiveRed = 0; }

    let shouldEnter = false;
    if (!position && (phaseFilter === undefined || phaseFilter === null || phaseFilter === phase)) {
      const signals = strategy.signals;
      if (signals.length === 1) {
        shouldEnter = evaluateSignal(candles, i, signals[0], { consecutiveRed, consecutiveGreen, phase });
      } else if (signals.length > 1) {
        const logic = strategy.signalLogic || 'AND';
        const results = signals.map(s => evaluateSignal(candles, i, s, { consecutiveRed, consecutiveGreen, phase }));
        if (logic === 'AND') shouldEnter = results.every(v => v);
        else if (logic === 'OR') shouldEnter = results.some(v => v);
        else if (logic === 'SEQUENCE') shouldEnter = evaluateSequence(candles, i, signals);
      }
    }

    if (!position && shouldEnter) {
      const entryCost = capital * COSTS.entry;
      capital -= entryCost;
      const entryTime = strategy.entryTiming || 'close';
      let entryPrice = c.close;
      if (entryTime === 'next_open' && i + 1 < candles.length) entryPrice = candles[i + 1].open;
      else if (entryTime === 'next_close' && i + 1 < candles.length) entryPrice = candles[i + 1].close;
      position = {
        entryPrice, entryIndex: i, size: capital, highestPrice: entryPrice,
        entryPhase: phase, trailStop: null
      };
      continue;
    }

    if (position) {
      let exitPrice = c.close;
      let exitTrigger = false;
      const pnlPct = (exitPrice - position.entryPrice) / position.entryPrice * 100;
      const holdDays = i - position.entryIndex;
      const trailingActive = strategy.trailingStop && strategy.trailingStop > 0;

      if (trailingActive) {
        position.highestPrice = Math.max(position.highestPrice, exitPrice);
        const trailStopPrice = position.highestPrice * (1 - strategy.trailingStop / 100);
        if (exitPrice <= trailStopPrice) exitTrigger = true;
      }

      if (!exitTrigger && pnlPct >= strategy.targetPct) exitTrigger = true;
      if (!exitTrigger && pnlPct <= -strategy.stopPct) exitTrigger = true;
      if (!exitTrigger && holdDays >= strategy.maxHoldDays) exitTrigger = true;

      if (exitTrigger) {
        const grossPnl = position.size * (pnlPct / 100);
        const exitCost = position.size * COSTS.exit;
        capital += grossPnl - exitCost;
        const netPnlPct = ((grossPnl - exitCost) / position.size) * 100;
        trades.push({ win: netPnlPct > 0, pnlPct: netPnlPct, holdDays });
        position = null;
      }
    }
  }

  if (trades.length === 0) return null;
  const wins = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const winRate = wins.length / trades.length * 100;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length) : 0;
  const expectancy = (winRate / 100 * avgWin) - ((1 - winRate / 100) * avgLoss);
  const totalReturn = ((capital - 100) / 100) * 100;
  return { trades: trades.length, winRate, expectancy, totalReturn, avgWin, avgLoss, capital };
}

function evaluateSignal(candles, i, signal, ctx) {
  const p = signal.params;
  switch (signal.type) {
    case 'consecutive_red': return ctx.consecutiveRed >= p.count;
    case 'consecutive_green': return ctx.consecutiveGreen >= p.count;
    case 'price_drop':
      const dropPct = (candles[i].open - candles[i].close) / candles[i].open * 100;
      return dropPct >= p.dropPct;
    case 'rsi':
      const rsi = calculateRSI(candles, i, p.period || 14);
      if (p.compare === '<') return rsi !== null && rsi < p.threshold;
      if (p.compare === '>') return rsi !== null && rsi > p.threshold;
      return false;
    case 'volume_spike':
      const avgVol = candles.slice(Math.max(0, i - 20), i + 1).reduce((s, c) => s + c.volume, 0) / 21;
      return candles[i].volume / avgVol >= p.multiplier;
    case 'ma_distance':
      const ma = candles.slice(Math.max(0, i - p.period), i + 1).reduce((s, c) => s + c.close, 0) / p.period;
      const dist = (candles[i].close - ma) / ma * 100;
      if (p.compare === '<') return dist < p.value;
      if (p.compare === '>') return dist > p.value;
      return false;
    case 'phase_transition':
      const prevPhase = detectPhase(candles, i - 1, p.lookback || 20);
      return prevPhase !== ctx.phase && ctx.phase === p.toPhase;
    default: return false;
  }
}

function evaluateSequence(candles, i, signals) {
  let idx = i - signals.length + 1;
  if (idx < 0) return false;
  for (let s = 0; s < signals.length; s++) {
    const sigCtx = { consecutiveRed: 0, consecutiveGreen: 0, phase: detectPhase(candles, idx + s, 20) };
    if (!evaluateSignal(candles, idx + s, signals[s], sigCtx)) return false;
  }
  return true;
}

function calculateRSI(candles, i, period = 14) {
  if (i < period) return null;
  let gains = 0, losses = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const delta = candles[j].close - candles[j - 1].close;
    if (delta > 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function fitness(result) {
  if (!result) return -1e6;
  if (result.trades < MIN_TRADES) return -1e6;
  if (result.expectancy < EXPECTANCY_MIN) return -1e6;
  let score = result.expectancy * Math.sqrt(result.trades);
  if (result.winRate > 60) score *= 1.2;
  if (result.winRate > 70) score *= 1.3;
  return score;
}

function randomSignal() {
  const types = ['consecutive_red', 'consecutive_green', 'price_drop', 'rsi', 'volume_spike', 'ma_distance', 'phase_transition'];
  const type = types[Math.floor(Math.random() * types.length)];
  const params = {};
  switch (type) {
    case 'consecutive_red': params.count = Math.floor(Math.random() * 4) + 2; break;
    case 'consecutive_green': params.count = Math.floor(Math.random() * 4) + 2; break;
    case 'price_drop': params.dropPct = [1, 2, 3, 4, 5, 6, 7, 8, 10][Math.floor(Math.random() * 9)]; break;
    case 'rsi':
      params.period = [7, 14, 21][Math.floor(Math.random() * 3)];
      params.compare = Math.random() > 0.5 ? '<' : '>';
      params.threshold = params.compare === '<' ? [20, 25, 30, 35][Math.floor(Math.random() * 4)] : [65, 70, 75][Math.floor(Math.random() * 3)];
      break;
    case 'volume_spike': params.multiplier = [1.5, 2, 2.5, 3][Math.floor(Math.random() * 4)]; break;
    case 'ma_distance':
      params.period = [20, 50, 200][Math.floor(Math.random() * 3)];
      params.compare = Math.random() > 0.5 ? '<' : '>';
      params.value = Math.floor(Math.random() * 10) + 2;
      break;
    case 'phase_transition':
      params.lookback = 20;
      params.toPhase = Math.floor(Math.random() * 4);
      break;
  }
  return { type, params };
}

function randomStrategy() {
  const numSignals = Math.floor(Math.random() * 3) + 1;
  const signals = [];
  for (let i = 0; i < numSignals; i++) signals.push(randomSignal());
  const signalLogic = signals.length === 1 ? 'AND' : (Math.random() > 0.5 ? 'AND' : (Math.random() > 0.5 ? 'OR' : 'SEQUENCE'));
  const phaseFilter = Math.random() > 0.7 ? Math.floor(Math.random() * 4) : null;
  return {
    signals, signalLogic, phaseFilter, phaseLookback: 20,
    entryTiming: ['close', 'next_open', 'next_close'][Math.floor(Math.random() * 3)],
    targetPct: [0.5, 1, 1.5, 2, 2.5, 3, 4, 5][Math.floor(Math.random() * 8)],
    stopPct: [0.3, 0.5, 0.75, 1, 1.5, 2, 2.5][Math.floor(Math.random() * 7)],
    maxHoldDays: [2, 3, 5, 7, 10, 14, 21][Math.floor(Math.random() * 7)],
    trailingStop: Math.random() > 0.8 ? [0.5, 1, 1.5, 2][Math.floor(Math.random() * 4)] : 0
  };
}

function mutate(strategy, rate) {
  const newStrat = JSON.parse(JSON.stringify(strategy));
  if (Math.random() < rate) newStrat.signals = [randomSignal()];
  else if (Math.random() < rate) {
    if (newStrat.signals.length < 3 && Math.random() < 0.5) newStrat.signals.push(randomSignal());
    else if (newStrat.signals.length > 1 && Math.random() < 0.5) newStrat.signals.pop();
  }
  if (Math.random() < rate) newStrat.signalLogic = ['AND', 'OR', 'SEQUENCE'][Math.floor(Math.random() * 3)];
  if (Math.random() < rate) newStrat.phaseFilter = Math.random() > 0.7 ? Math.floor(Math.random() * 4) : null;
  if (Math.random() < rate) newStrat.entryTiming = ['close', 'next_open', 'next_close'][Math.floor(Math.random() * 3)];
  if (Math.random() < rate) newStrat.targetPct = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5][Math.floor(Math.random() * 8)];
  if (Math.random() < rate) newStrat.stopPct = [0.3, 0.5, 0.75, 1, 1.5, 2, 2.5][Math.floor(Math.random() * 7)];
  if (Math.random() < rate) newStrat.maxHoldDays = [2, 3, 5, 7, 10, 14, 21][Math.floor(Math.random() * 7)];
  if (Math.random() < rate) newStrat.trailingStop = Math.random() > 0.8 ? [0.5, 1, 1.5, 2][Math.floor(Math.random() * 4)] : 0;
  if (newStrat.stopPct >= newStrat.targetPct) newStrat.stopPct = newStrat.targetPct * 0.7;
  return newStrat;
}

function crossover(a, b) {
  const child = JSON.parse(JSON.stringify(a));
  if (Math.random() < 0.5) child.signals = JSON.parse(JSON.stringify(b.signals));
  if (Math.random() < 0.5) child.signalLogic = b.signalLogic;
  if (Math.random() < 0.5) child.phaseFilter = b.phaseFilter;
  if (Math.random() < 0.5) child.targetPct = b.targetPct;
  if (Math.random() < 0.5) child.stopPct = b.stopPct;
  if (Math.random() < 0.5) child.maxHoldDays = b.maxHoldDays;
  if (Math.random() < 0.5) child.trailingStop = b.trailingStop;
  if (child.stopPct >= child.targetPct) child.stopPct = child.targetPct * 0.7;
  return child;
}

function shuffleBlocks(arr, blockSize) {
  const blocks = [];
  for (let i = 0; i < arr.length; i += blockSize) blocks.push(arr.slice(i, i + blockSize));
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks.flat();
}

async function monteCarloValidate(strategy, candles, shuffles = MONTE_CARLO_SHUFFLES) {
  let profitable = 0;
  for (let i = 0; i < shuffles; i++) {
    const shuffled = shuffleBlocks(candles.slice(), MONTE_CARLO_WINDOW);
    const result = backtest(shuffled, strategy);
    if (result && result.totalReturn > 0) profitable++;
  }
  return profitable / shuffles;
}

async function loadCandles(pair) {
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);
  const result = db.exec(`SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = '1D' ORDER BY timestamp ASC`, [pair]);
  db.close();
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const c = {};
    columns.forEach((col, i) => c[col] = row[i]);
    return c;
  });
}

async function discover(pair) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧬 GENETIC DISCOVERY v2 — ${pair}`);
  console.log(`${'='.repeat(70)}`);
  const candles = await loadCandles(pair);
  if (candles.length === 0) { console.log(`❌ No data for ${pair}`); return; }
  const split = Math.floor(candles.length * 0.7);
  const train = candles.slice(0, split);
  const test = candles.slice(split);

  console.log(`Phase 1: Seeding from grid...`);
  const seeds = [];
  for (let count of [2, 3, 4]) seeds.push({ signals: [{ type: 'consecutive_red', params: { count } }], signalLogic: 'AND', phaseFilter: null, entryTiming: 'close', targetPct: 2, stopPct: 1, maxHoldDays: 5, trailingStop: 0 });
  for (let threshold of [20, 25, 30]) seeds.push({ signals: [{ type: 'rsi', params: { period: 14, compare: '<', threshold } }], signalLogic: 'AND', phaseFilter: null, entryTiming: 'close', targetPct: 2, stopPct: 1, maxHoldDays: 5, trailingStop: 0 });
  for (let dropPct of [3, 5, 7]) seeds.push({ signals: [{ type: 'price_drop', params: { dropPct } }], signalLogic: 'AND', phaseFilter: null, entryTiming: 'close', targetPct: 2, stopPct: 1, maxHoldDays: 5, trailingStop: 0 });
  for (let mult of [1.5, 2]) seeds.push({ signals: [{ type: 'volume_spike', params: { multiplier: mult } }], signalLogic: 'AND', phaseFilter: null, entryTiming: 'close', targetPct: 2, stopPct: 1, maxHoldDays: 5, trailingStop: 0 });
  for (let toPhase of [0, 1, 2, 3]) seeds.push({ signals: [{ type: 'phase_transition', params: { lookback: 20, toPhase } }], signalLogic: 'AND', phaseFilter: null, entryTiming: 'close', targetPct: 2, stopPct: 1, maxHoldDays: 5, trailingStop: 0 });
  for (let s of seeds) { const r = backtest(train, s); if (r && r.expectancy > 0) s.fitness = fitness(r); else s.fitness = -1e6; }
  let population = seeds.filter(s => s.fitness > -1e6);
  while (population.length < POP_SIZE) population.push(randomStrategy());

  console.log(`Phase 2: GA (${POP_SIZE} pop, ${GENERATIONS} gens)...`);
  let bestScore = -Infinity;
  let stagnation = 0;
  for (let gen = 0; gen < GENERATIONS; gen++) {
    const mutationRate = INIT_MUTATION_RATE - (INIT_MUTATION_RATE - FINAL_MUTATION_RATE) * (gen / GENERATIONS);
    for (let i = 0; i < population.length; i++) {
      const r = backtest(train, population[i]);
      population[i].fitness = r ? fitness(r) : -1e6;
    }
    population.sort((a, b) => b.fitness - a.fitness);
    const currentBest = population[0].fitness;
    if (currentBest > bestScore) { bestScore = currentBest; stagnation = 0; }
    else stagnation++;
    if (stagnation >= STAGNATION_LIMIT) {
      const injectCount = Math.floor(POP_SIZE * INJECTION);
      for (let i = 0; i < injectCount; i++) population[POP_SIZE - 1 - i] = randomStrategy();
      stagnation = 0;
    }
    const nextGen = population.slice(0, Math.floor(POP_SIZE * ELITE));
    while (nextGen.length < POP_SIZE) {
      const p1 = population[Math.floor(Math.random() * Math.floor(POP_SIZE * 0.3))];
      const p2 = population[Math.floor(Math.random() * Math.floor(POP_SIZE * 0.3))];
      let child = crossover(p1, p2);
      child = mutate(child, mutationRate);
      nextGen.push(child);
    }
    population = nextGen;
    if ((gen + 1) % 25 === 0) console.log(`  Gen ${gen + 1}/${GENERATIONS} — best fitness: ${bestScore.toFixed(2)}`);
  }
  population.sort((a, b) => b.fitness - a.fitness);
  const top = population.slice(0, 50);

  console.log(`Phase 3: Tuning entry timing...`);
  for (let s of top) {
    let best = { timing: s.entryTiming, fitness: s.fitness };
    for (let timing of ['close', 'next_open', 'next_close']) {
      const candidate = { ...s, entryTiming: timing };
      const r = backtest(train, candidate);
      const fit = r ? fitness(r) : -1e6;
      if (fit > best.fitness) { best = { timing, fitness: fit }; }
    }
    s.entryTiming = best.timing;
    const r = backtest(train, s);
    s.fitness = r ? fitness(r) : -1e6;
  }
  top.sort((a, b) => b.fitness - a.fitness);

  console.log(`Phase 4: Monte Carlo validation (${MONTE_CARLO_SHUFFLES} shuffles)...`);
  const validated = [];
  for (let s of top.slice(0, 20)) {
    const passRatio = await monteCarloValidate(s, train);
    if (passRatio >= MONTE_CARLO_PROFIT_RATIO) {
      const testResult = backtest(test, s);
      if (testResult && testResult.expectancy > EXPECTANCY_MIN * 0.5) {
        validated.push({ strategy: s, trainFit: s.fitness, testExpectancy: testResult.expectancy, testReturn: testResult.totalReturn, monteCarloRatio: passRatio });
      }
    }
  }

  console.log(`\n✅ Validated strategies: ${validated.length}`);
  validated.sort((a, b) => b.testExpectancy - a.testExpectancy);
  for (let i = 0; i < Math.min(10, validated.length); i++) {
    const v = validated[i];
    console.log(`\n${i + 1}. Expectancy: ${v.testExpectancy.toFixed(2)} | Return: ${v.testReturn.toFixed(1)}% | MC: ${(v.monteCarloRatio * 100).toFixed(0)}%`);
    console.log(`   Signals: ${v.strategy.signals.map(s => `${s.type}(${JSON.stringify(s.params)})`).join(' ')}`);
    console.log(`   Logic: ${v.strategy.signalLogic} | Phase: ${v.strategy.phaseFilter !== null ? v.strategy.phaseFilter : 'ANY'}`);
    console.log(`   Entry: ${v.strategy.entryTiming} | Target: ${v.strategy.targetPct}% | Stop: ${v.strategy.stopPct}% | Hold: ${v.strategy.maxHoldDays}d | Trail: ${v.strategy.trailingStop || 0}%`);
  }
  if (validated.length) {
    fs.writeFileSync(path.join(O_DIR, `${pair.replace('/', '_')}_genetic.json`), JSON.stringify(validated, null, 2));
  }
  return validated;
}

(async () => {
  const pairs = process.argv.slice(2);
  const targets = pairs.length ? pairs : ['BTC/USD'];
  for (const p of targets) await discover(p);
})().catch(console.error);
