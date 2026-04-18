#!/usr/bin/env node
/**
 * chronoscribe.js
 * Lightweight audit trail for the Forge platform.
 * Timestamps, validates, and cryptographically signs key platform events.
 *
 * Three schemas:
 *   strategy_validation_v1  — strategy passed or failed validation
 *   regime_change_v1        — confirmed market regime shift
 *   capsule_promotion_v1    — hypothesis promoted to dry_run
 *
 * Usage (as module):
 *   const cs = require('./chronoscribe');
 *   cs.record('strategy_validation_v1', { ... });
 *
 * Usage (CLI audit):
 *   node chronoscribe.js --audit
 *   node chronoscribe.js --audit --schema strategy_validation_v1
 *   node chronoscribe.js --verify
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

let   AUDIT_LOG = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/chronoscribe_audit.json');
const OPERATOR  = 'JamesTheGiblet';
const VERSION   = '1.0.0';

// ── Schemas ────────────────────────────────────────────────────────────────────

const SCHEMAS = {

  strategy_validation_v1: {
    mnemonic: 'Every strategy result must be timestamped, signed, and retrievable.',
    required: ['strategy_name', 'result', 'win_rate', 'backtest_return', 'total_trades', 'regime'],
    validate: function(data) {
      const errors = [];
      if (!['passed', 'failed'].includes(data.result))
        errors.push('result must be passed or failed');
      if (typeof data.win_rate !== 'number' || data.win_rate < 0 || data.win_rate > 100)
        errors.push('win_rate must be a number between 0 and 100');
      if (typeof data.total_trades !== 'number' || data.total_trades < 0)
        errors.push('total_trades must be a non-negative number');
      return errors;
    }
  },

  regime_change_v1: {
    mnemonic: 'Every regime shift must be confirmed, timestamped, and signed before acting.',
    required: ['from_regime', 'to_regime', 'confirmed_days', 'btc_price'],
    validate: function(data) {
      const errors = [];
      const validRegimes = ['RANGING', 'QUIET', 'VOLATILE', 'TRENDING_UP', 'TRENDING_DOWN', 'UNKNOWN'];
      if (!validRegimes.includes(data.from_regime))
        errors.push('from_regime is not a valid regime');
      if (!validRegimes.includes(data.to_regime))
        errors.push('to_regime is not a valid regime');
      if (data.from_regime === data.to_regime)
        errors.push('from_regime and to_regime must be different');
      if (typeof data.confirmed_days !== 'number' || data.confirmed_days < 1)
        errors.push('confirmed_days must be at least 1');
      return errors;
    }
  },

  capsule_promotion_v1: {
    mnemonic: 'Every capsule promotion must be signed and traceable to its validation evidence.',
    required: ['capsule_id', 'capsule_name', 'from_status', 'to_status', 'validation_score'],
    validate: function(data) {
      const errors = [];
      if (!data.capsule_id || data.capsule_id.length < 5)
        errors.push('capsule_id is required and must be meaningful');
      if (!['hypothesis', 'generated'].includes(data.from_status))
        errors.push('from_status must be hypothesis or generated');
      if (data.to_status !== 'dry_run')
        errors.push('to_status must be dry_run');
      if (typeof data.validation_score !== 'number' || data.validation_score < 0)
        errors.push('validation_score must be a non-negative number');
      return errors;
    }
  }

};

// ── Core ───────────────────────────────────────────────────────────────────────

function loadLog() {
  try {
    if (fs.existsSync(AUDIT_LOG)) return JSON.parse(fs.readFileSync(AUDIT_LOG, 'utf8'));
  } catch (e) {}
  return { version: VERSION, records: [] };
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.writeFileSync(AUDIT_LOG, JSON.stringify(log, null, 2));
}

function sign(data) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 32);
}

function record(schemaId, data) {
  const schema = SCHEMAS[schemaId];
  if (!schema) {
    console.error('ChronoScribe: Unknown schema:', schemaId);
    return null;
  }

  // Check required fields
  const missing = schema.required.filter(f => data[f] === undefined || data[f] === null);
  if (missing.length) {
    console.error('ChronoScribe: Missing required fields:', missing.join(', '));
    return null;
  }

  // Run validation rules
  const errors = schema.validate(data);
  if (errors.length) {
    console.error('ChronoScribe: Validation errors:', errors.join(', '));
    return null;
  }

  const timestamp = new Date().toISOString();
  const payload   = { schema: schemaId, operator: OPERATOR, timestamp, data };
  const signature = sign(payload);

  const entry = {
    id:        signature,
    schema:    schemaId,
    operator:  OPERATOR,
    timestamp,
    data,
    signature,
    mnemonic:  schema.mnemonic
  };

  const log = loadLog();
  log.records.unshift(entry);
  saveLog(log);

  return entry;
}

// ── Verify ─────────────────────────────────────────────────────────────────────

function verify() {
  const log      = loadLog();
  const records  = log.records || [];
  let   valid    = 0;
  let   invalid  = 0;
  const tampered = [];

  for (const entry of records) {
    const payload   = { schema: entry.schema, operator: entry.operator, timestamp: entry.timestamp, data: entry.data };
    const expected  = sign(payload);
    if (expected === entry.signature) {
      valid++;
    } else {
      invalid++;
      tampered.push(entry.id);
    }
  }

  return { total: records.length, valid, invalid, tampered };
}

// ── Audit display ──────────────────────────────────────────────────────────────

function audit(schemaFilter) {
  const log     = loadLog();
  const records = log.records || [];
  const filtered = schemaFilter
    ? records.filter(r => r.schema === schemaFilter)
    : records;

  console.log('📜 CHRONOSCRIBE AUDIT');
  console.log('='.repeat(50));
  console.log('Total records: ' + records.length);

  // Count by schema
  const counts = {};
  for (const r of records) counts[r.schema] = (counts[r.schema] || 0) + 1;
  for (const [s, c] of Object.entries(counts)) console.log('  ' + s + ': ' + c);

  // Verify integrity
  const result = verify();
  console.log('\n🛡️  Integrity: ' + result.valid + '/' + result.total + ' valid');
  if (result.invalid > 0) console.log('🚨 TAMPERED: ' + result.tampered.join(', '));

  console.log('\n' + '='.repeat(50));

  if (filtered.length === 0) {
    console.log('No records' + (schemaFilter ? ' for schema: ' + schemaFilter : ''));
    return;
  }

  console.log((schemaFilter ? schemaFilter : 'All records') + ':');
  filtered.slice(0, 20).forEach(entry => {
    console.log('\n  [' + entry.timestamp.slice(0, 19) + '] ' + entry.schema);
    console.log('  ID: ' + entry.id);
    for (const [k, v] of Object.entries(entry.data)) {
      console.log('  ' + k + ': ' + v);
    }
  });
}

// ── Convenience wrappers ───────────────────────────────────────────────────────

function recordStrategyValidation(name, result, winRate, backtestReturn, totalTrades, regime, reason) {
  return record('strategy_validation_v1', {
    strategy_name:    name,
    result,
    win_rate:         typeof winRate === 'string' ? parseFloat(winRate) : winRate,
    backtest_return:  typeof backtestReturn === 'string' ? parseFloat(backtestReturn) : backtestReturn,
    total_trades:     totalTrades,
    regime,
    reason:           reason || ''
  });
}

function recordRegimeChange(fromRegime, toRegime, confirmedDays, btcPrice) {
  return record('regime_change_v1', {
    from_regime:    fromRegime,
    to_regime:      toRegime,
    confirmed_days: confirmedDays,
    btc_price:      btcPrice
  });
}

function recordCapsulePromotion(capsuleId, capsuleName, fromStatus, validationScore, winRate, backtestReturn) {
  return record('capsule_promotion_v1', {
    capsule_id:       capsuleId,
    capsule_name:     capsuleName,
    from_status:      fromStatus,
    to_status:        'dry_run',
    validation_score: validationScore,
    win_rate:         winRate,
    backtest_return:  backtestReturn
  });
}

// ── CLI ────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args   = process.argv.slice(2);
  const cmd    = args[0];
  const schema = args.indexOf('--schema') !== -1 ? args[args.indexOf('--schema') + 1] : null;

  if (cmd === '--audit') {
    audit(schema);
  } else if (cmd === '--verify') {
    const result = verify();
    console.log('🔐 CHRONOSCRIBE VERIFY');
    console.log('Total:   ' + result.total);
    console.log('Valid:   ' + result.valid);
    console.log('Invalid: ' + result.invalid);
    if (result.invalid > 0) {
      console.log('🚨 Tampered IDs:');
      result.tampered.forEach(id => console.log('  ' + id));
    } else {
      console.log('✅ All records intact.');
    }
  } else if (cmd === '--test') {
    console.log('🧪 Testing ChronoScribe (Using temporary test log)...\n');
    AUDIT_LOG = path.join(process.env.HOME, 'kraken-intelligence/reasoning-bot/data/test_audit.json');
    if (fs.existsSync(AUDIT_LOG)) fs.unlinkSync(AUDIT_LOG); // Start fresh

    const e1 = recordStrategyValidation('H.E Mean Reversion Bollinger', 'passed', 56.3, 45.2, 16, 'RANGING', 'Passed: 56.3% WR, +45.2% return, 16 trades');
    console.log('Strategy validation recorded:', e1 ? e1.id : 'FAILED');

    const e2 = recordRegimeChange('RANGING', 'TRENDING_UP', 3, 74569.0);
    console.log('Regime change recorded:', e2 ? e2.id : 'FAILED');

    const e3 = recordCapsulePromotion('hyp_h_e_mean_reversion_test', 'H.E Mean Reversion Test', 'hypothesis', 67.4, 56.3, 45.2);
    console.log('Capsule promotion recorded:', e3 ? e3.id : 'FAILED');

    console.log('\nRunning audit...\n');
    audit();
  } else {
    console.log('ChronoScribe v' + VERSION);
    console.log('Usage:');
    console.log('  node chronoscribe.js --audit                          (show all records)');
    console.log('  node chronoscribe.js --audit --schema strategy_validation_v1');
    console.log('  node chronoscribe.js --verify                         (check integrity)');
    console.log('  node chronoscribe.js --test                           (run test records)');
    console.log('\nModule usage:');
    console.log('  const cs = require(\'./chronoscribe\');');
    console.log('  cs.recordStrategyValidation(name, result, wr, ret, trades, regime, reason)');
    console.log('  cs.recordRegimeChange(from, to, days, btcPrice)');
    console.log('  cs.recordCapsulePromotion(id, name, fromStatus, score, wr, ret)');
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  record,
  verify,
  audit,
  recordStrategyValidation,
  recordRegimeChange,
  recordCapsulePromotion,
  SCHEMAS
};
