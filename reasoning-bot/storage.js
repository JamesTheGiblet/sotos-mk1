const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

class ReasoningBotStorage {
  constructor() {
    this.dbPath = path.join(__dirname, 'data', 'reasoning_bot.db');
    this.db = null;
  }

  async init() {
    const SQL = await initSqlJs();
    const dbBuffer = fs.readFileSync(this.dbPath);
    this.db = new SQL.Database(dbBuffer);
    console.log('📁 Database connected');
    return true;
  }

  // Save current database state to disk
  saveToDisk() {
    if (this.db) {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, data);
    }
  }

  saveMarketState(state) {
    if (!this.db) return null;
    try {
      this.db.run(
        `INSERT INTO market_states (timestamp, regime, phase, sentiment, volatility, trend, volume_ratio, btc_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          state.timestamp || new Date().toISOString(),
          state.regime || 'UNKNOWN',
          state.phase || 'UNKNOWN',
          state.sentiment || 'NEUTRAL',
          state.volatility || 0,
          state.trend || 0,
          state.volumeRatio || 1,
          state.btcPrice || 0
        ]
      );
      const result = this.db.exec("SELECT last_insert_rowid() as id");
      const id = result[0] ? result[0].values[0][0] : null;
      this.saveToDisk();
      return id;
    } catch (err) {
      console.error('Error saving market state:', err.message);
      return null;
    }
  }

  saveStrategySelection(selection, marketStateId) {
    if (!this.db) return;
    try {
      this.db.run(
        `INSERT INTO strategy_selections 
         (timestamp, strategy_id, strategy_name, score, target_pct, stop_pct, hold_days, reasoning, market_state_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          selection.timestamp || new Date().toISOString(),
          selection.selected || 'unknown',
          selection.name || 'Unknown',
          selection.score || 0,
          (selection.params && selection.params.target) || 0,
          (selection.params && selection.params.stop) || 0,
          (selection.params && selection.params.hold) || 0,
          selection.reasoning || '',
          marketStateId || null
        ]
      );
      this.saveToDisk();
    } catch (err) {
      console.error('Error saving strategy selection:', err.message);
    }
  }

  saveStrategyChange(change, marketStateId) {
    if (!this.db) return;
    try {
      this.db.run(
        `INSERT INTO strategy_changes (timestamp, from_strategy, to_strategy, reason, market_state_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          change.timestamp || new Date().toISOString(),
          change.from || null,
          change.to || null,
          change.reason || '',
          marketStateId || null
        ]
      );
      this.saveToDisk();
    } catch (err) {
      console.error('Error saving strategy change:', err.message);
    }
  }

  saveAlert(severity, type, message) {
    if (!this.db) return;
    try {
      this.db.run(
        `INSERT INTO alerts (timestamp, severity, type, message) VALUES (?, ?, ?, ?)`,
        [new Date().toISOString(), severity, type, message]
      );
      this.saveToDisk();
    } catch (err) {
      console.error('Error saving alert:', err.message);
    }
  }

  getMarketStateHistory(limit) {
    limit = limit || 100;
    if (!this.db) return [];
    try {
      const result = this.db.exec("SELECT * FROM market_states ORDER BY timestamp DESC LIMIT " + limit);
      if (!result.length) return [];
      const columns = result[0].columns;
      const values = result[0].values;
      return values.map(function(row) {
        var obj = {};
        for (var i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj;
      });
    } catch (err) {
      return [];
    }
  }

  getStrategyHistory(limit) {
    limit = limit || 100;
    if (!this.db) return [];
    try {
      const result = this.db.exec("SELECT * FROM strategy_selections ORDER BY timestamp DESC LIMIT " + limit);
      if (!result.length) return [];
      const columns = result[0].columns;
      const values = result[0].values;
      return values.map(function(row) {
        var obj = {};
        for (var i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj;
      });
    } catch (err) {
      return [];
    }
  }

  getStrategyChanges(limit) {
    limit = limit || 50;
    if (!this.db) return [];
    try {
      const result = this.db.exec("SELECT * FROM strategy_changes ORDER BY timestamp DESC LIMIT " + limit);
      if (!result.length) return [];
      const columns = result[0].columns;
      const values = result[0].values;
      return values.map(function(row) {
        var obj = {};
        for (var i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj;
      });
    } catch (err) {
      return [];
    }
  }

  getActiveAlerts() {
    if (!this.db) return [];
    try {
      const result = this.db.exec("SELECT * FROM alerts WHERE acknowledged = 0 ORDER BY timestamp DESC");
      if (!result.length) return [];
      const columns = result[0].columns;
      const values = result[0].values;
      return values.map(function(row) {
        var obj = {};
        for (var i = 0; i < columns.length; i++) {
          obj[columns[i]] = row[i];
        }
        return obj;
      });
    } catch (err) {
      return [];
    }
  }

  getStats() {
    if (!this.db) return { totalStates: 0, totalSelections: 0, totalChanges: 0, activeAlerts: 0 };
    try {
      var totalStates = 0;
      var totalSelections = 0;
      var totalChanges = 0;
      var activeAlerts = 0;
      
      var res = this.db.exec("SELECT COUNT(*) as count FROM market_states");
      if (res.length) totalStates = res[0].values[0][0];
      
      res = this.db.exec("SELECT COUNT(*) as count FROM strategy_selections");
      if (res.length) totalSelections = res[0].values[0][0];
      
      res = this.db.exec("SELECT COUNT(*) as count FROM strategy_changes");
      if (res.length) totalChanges = res[0].values[0][0];
      
      res = this.db.exec("SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0");
      if (res.length) activeAlerts = res[0].values[0][0];
      
      return { totalStates: totalStates, totalSelections: totalSelections, totalChanges: totalChanges, activeAlerts: activeAlerts };
    } catch (err) {
      return { totalStates: 0, totalSelections: 0, totalChanges: 0, activeAlerts: 0 };
    }
  }

  close() {
    if (this.db) {
      this.saveToDisk();
      this.db.close();
    }
  }
}

module.exports = ReasoningBotStorage;
