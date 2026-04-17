#!/usr/bin/env node
/**
 * forge-evolution.js
 * Evolutionary strategy engine — QuantAlgo rebuilt for Kraken crypto.
 *
 * Three agent types compete across generations.
 * Top performers reproduce with mutation.
 * Bottom performers are eliminated.
 * Champion gets added to the strategy selector pool.
 *
 * Population: 20 strategies
 * Generations: 5
 * Split: 80% backtest / 20% forward validation
 *
 * Usage:
 *   node forge-evolution.js
 *   node forge-evolution.js --generations 10
 *   node forge-evolution.js --population 30
 */

'use strict';

const fs        = require('fs');
const path      = require('path');
const initSqlJs = require('sql.js');

const DB_PATH      = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const SELECTOR_PATH = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/strategy_selector.js');
const ARCHIVE_FILE  = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/strategy_archive.json');
const EVOLUTION_LOG = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/evolution_log.json');

// ── Config ─────────────────────────────────────────────────────────────────────

const POPULATION_SIZE    = 20;
const GENERATIONS        = 5;
const ELIMINATION_RATE   = 0.3;  // Bottom 30% eliminated each generation
const MUTATION_RATE      = 0.2;  // 20% chance each parameter mutates
const MUTATION_STRENGTH  = 0.15; // Parameters vary by up to 15%
const TRAIN_SPLIT        = 0.8;
const WARMUP             = 50;
const MIN_WIN_RATE       = 50;
const MIN_RETURN         = 0;
const MIN_TRADES         = 10;

// ── Agent types ────────────────────────────────────────────────────────────────

const AGENT_TYPES = {

  trend_follower: {
    name: 'Trend Follower',
    description: 'Buy when momentum confirmed, ride the trend',
    defaults: { rsiThreshold: 45, maShort: 10, maLong: 30, stop: 5, target: 12, hold: 10 },
    ranges:   { rsiThreshold: [35, 55], maShort: [5, 20], maLong: [20, 50], stop: [3, 10], target: [8, 20], hold: [7, 14] },
    entry: (params, candles, idx) => {
      const closes  = candles.slice(0, idx + 1).map(c => c.close);
      const rsi     = calcRSI(closes, 14);
      const maShort = calcMA(closes, params.maShort);
      const maLong  = calcMA(closes, params.maLong);
      return rsi > params.rsiThreshold && maShort > maLong;
    },
    exit: (params, candles, idx) => {
      const closes = candles.slice(0, idx + 1).map(c => c.close);
      const rsi    = calcRSI(closes, 14);
      return rsi > 70;
    }
  },

  mean_reverter: {
    name: 'Mean Reverter',
    description: 'Buy oversold dips, sell recovery',
    defaults: { rsiEntry: 32, rsiExit: 55, redDays: 3, stop: 6, target: 13, hold: 10 },
    ranges:   { rsiEntry: [20, 40], rsiExit: [50, 65], redDays: [2, 5], stop: [3, 10], target: [8, 20], hold: [7, 14] },
    entry: (params, candles, idx) => {
      const closes = candles.slice(0, idx + 1).map(c => c.close);
      const rsi    = calcRSI(closes, 14);
      const bb     = calcBollinger(closes, 20);
      const red    = calcConsecRed(candles, idx);
      return rsi < params.rsiEntry && red >= params.redDays && bb.lower !== null && candles[idx].close < bb.lower;
    },
    exit: (params, candles, idx) => {
      const closes = candles.slice(0, idx + 1).map(c => c.close);
      const rsi    = calcRSI(closes, 14);
      return rsi > params.rsiExit;
    }
  },

  volatility_seeker: {
    name: 'Volatility Seeker',
    description: 'Buy volatility spikes with volume confirmation',
    defaults: { volThreshold: 2.5, volumeMultiplier: 1.5, rsiMax: 60, stop: 8, target: 16, hold: 7 },
    ranges:   { volThreshold: [1.5, 4.0], volumeMultiplier: [1.2, 2.5], rsiMax: [50, 70], stop: [4, 12], target: [10, 25], hold: [5, 12] },
    entry: (params, candles, idx) => {
      const candle  = candles[idx];
      const closes  = candles.slice(0, idx + 1).map(c => c.close);
      const vol     = candle.open > 0 ? (candle.high - candle.low) / candle.open * 100 : 0;
      const avgVol  = calcVolumeAvg(candles, idx, 20);
      const rsi     = calcRSI(closes, 14);
      return vol > params.volThreshold && candle.volume > avgVol * params.volumeMultiplier && rsi < params.rsiMax;
    },
    exit: (params, candles, idx) => {
      const closes = candles.slice(0, idx + 1).map(c => c.close);
      const rsi    = calcRSI(closes, 14);
      return rsi > 65;
    }
  }

};

// ── Indicators ─────────────────────────────────────────────────────────────────

function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

function calcMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcBollinger(closes, period) {
  period = period || 20;
  if (closes.length < period) return { upper: null, middle: null, lower: null };
  const w   = closes.slice(-period);
  const mid = w.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(w.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period);
  return { upper: mid + 2 * std, middle: mid, lower: mid - 2 * std };
}

function calcConsecRed(candles, idx) {
  let count = 0, i = idx;
  while (i >= 0 && candles[i].close < candles[i].open) { count++; i--; }
  return count;
}

function calcVolumeAvg(candles, idx, period) {
  period = period || 20;
  const vols = candles.slice(Math.max(0, idx - period), idx).map(c => c.volume);
  if (!vols.length) return 0;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

// ── Simulation ─────────────────────────────────────────────────────────────────

function simulate(agent, params, candles) {
  let capital    = 1000;
  let inPosition = false;
  let entryPrice = 0;
  let entryIdx   = 0;
  const trades   = [];

  for (let i = WARMUP; i < candles.length; i++) {
    const price = candles[i].close;
    if (!inPosition) {
      if (agent.entry(params, candles, i)) {
        inPosition = true;
        entryPrice = price;
        entryIdx   = i;
      }
    } else {
      const hold   = i - entryIdx;
      const pnlPct = entryPrice > 0 ? (price - entryPrice) / entryPrice : 0;
      const hitTP  = pnlPct >= params.target / 100;
      const hitSL  = pnlPct <= -params.stop / 100;
      const hitT   = hold >= params.hold;
      const hitE   = agent.exit(params, candles, i);

      if (hitTP || hitSL || hitT || hitE) {
        capital *= (1 + pnlPct);
        trades.push({
          pnl:    Math.round(pnlPct * 10000) / 100,
          win:    pnlPct > 0,
          hold,
          reason: hitTP ? 'take_profit' : hitSL ? 'stop_loss' : hitT ? 'timeout' : 'exit_rule'
        });
        inPosition = false;
      }
    }
  }

  if (inPosition) {
    const price  = candles[candles.length - 1].close;
    const pnlPct = entryPrice > 0 ? (price - entryPrice) / entryPrice : 0;
    capital *= (1 + pnlPct);
    trades.push({ pnl: Math.round(pnlPct * 10000) / 100, win: pnlPct > 0, hold: candles.length - entryIdx, reason: 'closeout' });
  }

  const total = trades.length;
  const wins  = trades.filter(t => t.win).length;
  const wr    = total > 0 ? Math.round(wins / total * 1000) / 10 : 0;
  const ret   = Math.round((capital - 1000) / 1000 * 1000) / 10;
  return { total_trades: total, win_rate: wr, backtest_return: ret, capital_final: Math.round(capital * 100) / 100 };
}

// ── Scoring ────────────────────────────────────────────────────────────────────

function score(metrics) {
  if (metrics.total_trades < MIN_TRADES) return 0;
  if (metrics.win_rate < MIN_WIN_RATE)   return 0;
  if (metrics.backtest_return <= MIN_RETURN) return 0;
  return Math.round((metrics.win_rate * 0.6 + Math.max(0, metrics.backtest_return) * 0.4) * 10) / 10;
}

// ── Population ─────────────────────────────────────────────────────────────────

function createIndividual(agentType, params) {
  return { agentType, params: { ...params }, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
}

function randomInRange(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function initialPopulation(size) {
  const population = [];
  const types      = Object.keys(AGENT_TYPES);

  for (let i = 0; i < size; i++) {
    const type   = types[i % types.length];
    const agent  = AGENT_TYPES[type];
    const params = {};

    // Randomise parameters within ranges
    for (const [key, range] of Object.entries(agent.ranges)) {
      params[key] = randomInRange(range[0], range[1]);
    }

    population.push(createIndividual(type, params));
  }
  return population;
}

function mutate(individual) {
  const agent    = AGENT_TYPES[individual.agentType];
  const newParams = { ...individual.params };

  for (const [key, range] of Object.entries(agent.ranges)) {
    if (Math.random() < MUTATION_RATE) {
      const current  = newParams[key];
      const delta    = current * MUTATION_STRENGTH * (Math.random() > 0.5 ? 1 : -1);
      newParams[key] = Math.round(Math.max(range[0], Math.min(range[1], current + delta)) * 100) / 100;
    }
  }

  return createIndividual(individual.agentType, newParams);
}

function reproduce(population, eliminationRate) {
  const sorted    = [...population].sort((a, b) => (b.fitness || 0) - (a.fitness || 0));
  const keepCount = Math.ceil(sorted.length * (1 - eliminationRate));
  const survivors = sorted.slice(0, keepCount);
  const newPop    = [...survivors];

  // Fill back to population size with mutations of top performers
  while (newPop.length < POPULATION_SIZE) {
    const parent = survivors[Math.floor(Math.random() * Math.min(5, survivors.length))];
    newPop.push(mutate(parent));
  }

  return newPop;
}

// ── Strategy pool ──────────────────────────────────────────────────────────────

function addChampionToPool(champion, trainMetrics, forwardMetrics) {
  if (!fs.existsSync(SELECTOR_PATH)) return;

  const agent   = AGENT_TYPES[champion.agentType];
  const cleanId = 'evo_' + champion.agentType + '_' + champion.id;

  const newStrategy = {
    name:             'EVO ' + agent.name + ' (' + champion.id + ')',
    entry:            agent.description,
    target:           champion.params.target   || 12,
    stop:             champion.params.stop      || 5,
    hold:             Math.round(champion.params.hold || 10),
    bestRegimes:      ['RANGING', 'TRENDING_UP', 'TRENDING_DOWN'],
    bestSentiment:    ['NEUTRAL', 'FEAR', 'GREED'],
    minVolatility:    0.5,
    maxVolatility:    6.0,
    validated:        true,
    evolved:          true,
    agent_type:       champion.agentType,
    params:           champion.params,
    win_rate:         trainMetrics.win_rate + '%',
    backtest_return:  (trainMetrics.backtest_return >= 0 ? '+' : '') + trainMetrics.backtest_return + '%',
    forward_win_rate: forwardMetrics.win_rate + '%',
    forward_return:   (forwardMetrics.backtest_return >= 0 ? '+' : '') + forwardMetrics.backtest_return + '%',
    fitness:          champion.fitness,
    validated_at:     new Date().toISOString()
  };

  let content = fs.readFileSync(SELECTOR_PATH, 'utf8');
  if (content.includes("'" + cleanId + "'")) {
    console.log('   Champion already in pool');
    return;
  }

  const insertPoint = content.indexOf('    };\n  }');
  if (insertPoint === -1) { console.log('   Could not find insertion point'); return; }

  const entry = ',\n      \'' + cleanId + '\': ' + JSON.stringify(newStrategy, null, 6).replace(/^/gm, '      ').trim();
  content     = content.slice(0, insertPoint) + entry + '\n' + content.slice(insertPoint);
  fs.writeFileSync(SELECTOR_PATH, content);
  console.log('   Added EVO ' + agent.name + ' to strategy pool');
}

// ── Archive losers ─────────────────────────────────────────────────────────────

function archiveLoser(individual, reason) {
  let archive = [];
  try { if (fs.existsSync(ARCHIVE_FILE)) archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); } catch (e) {}
  archive.unshift({
    id:          individual.id,
    agent_type:  individual.agentType,
    params:      individual.params,
    fitness:     individual.fitness || 0,
    reason,
    archived_at: new Date().toISOString()
  });
  fs.mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive.slice(0, 100), null, 2));
}

// ── Data ───────────────────────────────────────────────────────────────────────

async function loadCandles(symbol, interval, limit) {
  symbol   = symbol   || 'BTC/USD';
  interval = interval || '1D';
  limit    = limit    || 721;
  const SQL    = await initSqlJs();
  const db     = new SQL.Database(fs.readFileSync(DB_PATH));
  const result = db.exec(
    'SELECT timestamp, open, high, low, close, volume FROM candles WHERE pair = ? AND interval = ? ORDER BY timestamp ASC LIMIT ?',
    [symbol, interval, limit]
  );
  db.close();
  if (!result.length || !result[0].values.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const c = {};
    columns.forEach((col, i) => c[col] = typeof row[i] === 'bigint' ? Number(row[i]) : row[i]);
    return c;
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function evolve(generations, populationSize) {
  generations    = generations    || GENERATIONS;
  populationSize = populationSize || POPULATION_SIZE;

  console.log('FORGE EVOLUTION ENGINE');
  console.log('='.repeat(50));
  console.log('   Generations:  ' + generations);
  console.log('   Population:   ' + populationSize);
  console.log('   Agent types:  ' + Object.keys(AGENT_TYPES).join(', '));
  console.log('   Elimination:  ' + (ELIMINATION_RATE * 100) + '% per generation');
  console.log('   Mutation:     ' + (MUTATION_RATE * 100) + '% rate, ' + (MUTATION_STRENGTH * 100) + '% strength');
  console.log('='.repeat(50));

  // Load data
  console.log('\n   Loading candle data...');
  const candles = await loadCandles('BTC/USD', '1D', 721);
  if (!candles.length) { console.log('   No candle data'); return; }

  const splitIdx    = Math.floor(candles.length * TRAIN_SPLIT);
  const trainData   = candles.slice(0, splitIdx);
  const forwardData = candles.slice(splitIdx);
  console.log('   Loaded ' + candles.length + ' candles (' + trainData.length + ' train / ' + forwardData.length + ' forward)');

  // Initialise population
  let population = initialPopulation(populationSize);
  const evolutionLog = [];

  // Evolution loop
  for (let gen = 1; gen <= generations; gen++) {
    console.log('\nGENERATION ' + gen + '/' + generations);
    console.log('-'.repeat(40));

    // Evaluate each individual
    let evaluated = 0;
    for (const individual of population) {
      const agent   = AGENT_TYPES[individual.agentType];
      const metrics = simulate(agent, individual.params, trainData);
      individual.fitness      = score(metrics);
      individual.trainMetrics = metrics;
      evaluated++;
      if (evaluated % 5 === 0) process.stdout.write('   Evaluated ' + evaluated + '/' + population.length + '...\r');
    }
    console.log('   Evaluated ' + population.length + '/' + population.length + '    ');

    // Sort by fitness
    population.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));

    // Stats
    const passing    = population.filter(i => i.fitness > 0);
    const best       = population[0];
    const avgFitness = Math.round(population.reduce((a, b) => a + (b.fitness || 0), 0) / population.length * 10) / 10;

    console.log('   Best:    ' + AGENT_TYPES[best.agentType].name + ' — fitness ' + best.fitness + ' | WR: ' + best.trainMetrics.win_rate + '% | Return: +' + best.trainMetrics.backtest_return + '%');
    console.log('   Passing: ' + passing.length + '/' + population.length + ' | Avg fitness: ' + avgFitness);

    evolutionLog.push({
      generation:  gen,
      best_type:   best.agentType,
      best_fitness: best.fitness,
      best_wr:     best.trainMetrics.win_rate,
      best_return: best.trainMetrics.backtest_return,
      passing:     passing.length,
      avg_fitness: avgFitness
    });

    // Archive eliminated
    const eliminated = population.slice(Math.ceil(population.length * (1 - ELIMINATION_RATE)));
    for (const loser of eliminated) {
      if (loser.fitness === 0) archiveLoser(loser, 'Eliminated gen ' + gen + ' — fitness 0');
    }

    // Reproduce
    if (gen < generations) {
      population = reproduce(population, ELIMINATION_RATE);
    }
  }

  // Champion — forward validate the best
  const champion = population[0];
  console.log('\nCHAMPION: ' + AGENT_TYPES[champion.agentType].name);
  console.log('   Params: ' + JSON.stringify(champion.params));

  console.log('\n   Running forward validation...');
  const forwardMetrics = simulate(AGENT_TYPES[champion.agentType], champion.params, forwardData);
  const forwardScore   = score(forwardMetrics);

  console.log('   Backtest:  WR ' + champion.trainMetrics.win_rate + '% | Return +' + champion.trainMetrics.backtest_return + '% | ' + champion.trainMetrics.total_trades + ' trades');
  console.log('   Forward:   WR ' + forwardMetrics.win_rate + '% | Return ' + (forwardMetrics.backtest_return >= 0 ? '+' : '') + forwardMetrics.backtest_return + '% | ' + forwardMetrics.total_trades + ' trades');

  const passed = champion.fitness > 0 && forwardScore > 0;

  if (passed) {
    console.log('\n   CHAMPION PASSED — adding to strategy pool');
    addChampionToPool(champion, champion.trainMetrics, forwardMetrics);
  } else {
    console.log('\n   Champion failed forward validation — archiving');
    archiveLoser(champion, 'Failed forward validation — forward score: ' + forwardScore);
  }

  // Save evolution log
  const log = { run_at: new Date().toISOString(), generations, population_size: populationSize, champion: { agent_type: champion.agentType, fitness: champion.fitness, params: champion.params }, passed, evolution: evolutionLog };
  fs.mkdirSync(path.dirname(EVOLUTION_LOG), { recursive: true });
  fs.writeFileSync(EVOLUTION_LOG, JSON.stringify(log, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log('   Evolution complete.');
  if (passed) console.log('   Champion added to selector pool.');
  console.log('   Log saved to: ' + EVOLUTION_LOG);
  console.log('='.repeat(50));
}

// ── Entry ──────────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const genFlag    = args.indexOf('--generations');
const popFlag    = args.indexOf('--population');
const generations = genFlag !== -1 ? parseInt(args[genFlag + 1]) : GENERATIONS;
const popSize     = popFlag !== -1 ? parseInt(args[popFlag + 1]) : POPULATION_SIZE;

evolve(generations, popSize).catch(console.error);
