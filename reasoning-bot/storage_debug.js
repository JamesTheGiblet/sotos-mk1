const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class ReasoningBotStorage {
  constructor() {
    this.dbPath = path.join(__dirname, 'data', 'reasoning_bot.db');
    this.db = null;
  }

  async init() {
    if (!fs.existsSync(this.dbPath)) fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    console.log('📁 Database connected');
    return true;
  }

  saveMarketState(state) {
    console.log('saveMarketState called with:', state);
    if (!this.db) {
      console.log('Database not initialized');
      return null;
    }
    try {
      const info = this.db.prepare(
        `INSERT INTO market_states (timestamp, regime, phase, sentiment, volatility, trend, volume_ratio, btc_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        state.timestamp || new Date().toISOString(),
        state.regime || 'UNKNOWN',
        state.phase || 'UNKNOWN',
        state.sentiment || 'NEUTRAL',
        state.volatility || 0,
        state.trend || 0,
        state.volumeRatio || 1,
        state.btcPrice || 0
      );
      const id = info.lastInsertRowid;
      console.log('Saved market state with ID:', id);
      return id;
    } catch (err) {
      console.error('Error saving market state:', err.message);
      console.error(err.stack);
      return null;
    }
  }

  saveStrategySelection(selection, marketStateId) {
    console.log('saveStrategySelection called with:', selection.selected, marketStateId);
    if (!this.db) return;
    try {
      this.db.prepare(
        `INSERT INTO strategy_selections 
         (timestamp, strategy_id, strategy_name, score, target_pct, stop_pct, hold_days, reasoning, market_state_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        selection.timestamp || new Date().toISOString(),
        selection.selected || 'unknown',
        selection.name || 'Unknown',
        selection.score || 0,
        (selection.params && selection.params.target) || 0,
        (selection.params && selection.params.stop) || 0,
        (selection.params && selection.params.hold) || 0,
        selection.reasoning || '',
        marketStateId || null
      );
      console.log('Saved strategy selection');
    } catch (err) {
      console.error('Error saving strategy selection:', err.message);
    }
  }

  getStats() {
    if (!this.db) return { totalStates: 0, totalSelections: 0, totalChanges: 0, activeAlerts: 0 };
    try {
      var totalStates = 0;
      var totalSelections = 0;
      
      totalStates = this.db.prepare("SELECT COUNT(*) as count FROM market_states").get().count;
      totalSelections = this.db.prepare("SELECT COUNT(*) as count FROM strategy_selections").get().count;
      
      return { totalStates: totalStates, totalSelections: totalSelections, totalChanges: 0, activeAlerts: 0 };
    } catch (err) {
      console.error('Error getting stats:', err.message);
      return { totalStates: 0, totalSelections: 0, totalChanges: 0, activeAlerts: 0 };
    }
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = ReasoningBotStorage;
