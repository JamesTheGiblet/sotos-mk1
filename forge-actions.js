'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const HOME = process.env.HOME;
const BASE = path.join(HOME, 'kraken-intelligence');

function readJSON(p) {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}
  return null;
}

const ACTIONS = {
  auto_loop: {
    bg: true,
    run: function() {
      spawn('node', ['forge_auto.js', '5'], { cwd: BASE, detached: true, stdio: 'ignore' }).unref();
      return 'Forge auto loop started in background. 5 iterations running. Check monitor logs in a few minutes.';
    }
  },
  evolution: {
    bg: true,
    run: function() {
      spawn('node', ['forge-evolution.js'], { cwd: BASE, detached: true, stdio: 'ignore' }).unref();
      return 'Evolution engine started in background. 5 generations across 20 individuals. Results will appear in evolution_log.json.';
    }
  },
  monitor_log: {
    bg: false,
    run: function() {
      const log = readJSON(path.join(BASE, 'reasoning-bot/data/monitor_log.json'));
      if (!log) return 'No monitor log found.';
      const trades = log.trades || [];
      const wins   = trades.filter(function(t) { return t.win; }).length;
      const wr     = trades.length ? Math.round(wins / trades.length * 100) : 0;
      var result   = 'Checks: ' + (log.checks || 0) + ' | Trades: ' + trades.length + ' | WR: ' + wr + '%';
      var positions = Object.keys(log.positions || {});
      if (positions.length) result += ' | Open positions: ' + positions.join(', ');
      if (trades.length > 0) {
        var last = trades[trades.length - 1];
        result += '\nLast trade: ' + last.pair + ' ' + (last.pnl_pct >= 0 ? '+' : '') + last.pnl_pct + '% (' + last.reason + ')';
      }
      return result;
    }
  },
  pharaoh_logs: {
    bg: false,
    run: function() {
      var s = readJSON(path.join(HOME, 'golem/test-engines/pharaoh/data/pharaoh-state.json'));
      if (!s) return 'Cannot read Pharaoh state.';
      return 'Pharaoh: ' + s.currentState + ' | XRP: $' + s.xrpPrice + ' | RSI: ' + s.rsi.toFixed(1) + ' | F&G: ' + s.fearGreed + '/100 | Capital: $' + s.capital;
    }
  },
  audit: {
    bg: false,
    run: function() {
      try {
        return execSync('node chronoscribe.js --audit', { cwd: BASE, encoding: 'utf8', timeout: 5000 }).slice(0, 600);
      } catch(e) { return 'Audit error: ' + e.message; }
    }
  },
  dry_run_hypothesis: {
    bg: false,
    run: function() {
      try {
        var out = execSync('node forge-reasoning.js --dry-run', { cwd: BASE, encoding: 'utf8', timeout: 15000 });
        return out.split('\n').filter(function(l) {
          return l.trim() && !l.includes('{') && !l.includes('"');
        }).slice(0, 12).join('\n');
      } catch(e) { return 'Error: ' + e.message; }
    }
  },
  regime_state: {
    bg: false,
    run: function() {
      var s = readJSON(path.join(BASE, 'reasoning-bot/data/regime_state.json'));
      if (!s) return 'No regime state yet. Watcher runs at 6:30am daily.';
      return 'Regime: ' + (s.current_regime || 'unknown') + ' | Last checked: ' + (s.last_checked || 'never') + ' | Last trigger: ' + (s.last_trigger || 'never');
    }
  },
  system_status: {
    bg: false,
    run: function() {
      try {
        var procs = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
        var on  = procs.filter(function(p) { return p.pm2_env.status === 'online'; }).map(function(p) { return p.name; });
        var off = procs.filter(function(p) { return p.pm2_env.status !== 'online'; }).map(function(p) { return p.name; });
        return 'Online: ' + on.join(', ') + (off.length ? '\nStopped: ' + off.join(', ') : '');
      } catch(e) { return 'PM2 error: ' + e.message; }
    }
  }
};

function detect(msg) {
  var m = msg.toLowerCase();
  if (m.includes('auto loop') || m.includes('generate strat') || m.includes('run forge')) return 'auto_loop';
  if (m.includes('evolv') || m.includes('evolution') || m.includes('genetic')) return 'evolution';
  if (m.includes('monitor log') || m.includes('any signal') || m.includes('entry signal') || m.includes('check monitor')) return 'monitor_log';
  if (m.includes('pharaoh')) return 'pharaoh_logs';
  if (m.includes('audit') || m.includes('chronoscribe')) return 'audit';
  if (m.includes('hypothesis') || m.includes('preview') || m.includes('next strat') || m.includes('dry run')) return 'dry_run_hypothesis';
  if (m.includes('regime state') || m.includes('regime watcher') || m.includes('regime change')) return 'regime_state';
  if (m.includes('system status') || m.includes('all process') || m.includes('everything running') || m.includes('pm2')) return 'system_status';
  return null;
}

function handle(msg) {
  var key = detect(msg);
  if (!key) return null;
  try {
    var action = ACTIONS[key];
    return { response: action.run(), action: key, background: action.bg };
  } catch(e) {
    return { response: 'Action failed: ' + e.message, action: key, background: false };
  }
}

module.exports = { handle: handle, detect: detect };
