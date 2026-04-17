#!/bin/bash

# Daily Data Capture Script for Four Red Days Evaluation

REPORT_DIR="$HOME/kraken-intelligence/reports"
DAILY_DIR="$REPORT_DIR/daily"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$DAILY_DIR/${DATE}_report.json"

mkdir -p "$DAILY_DIR"

echo "📊 Capturing daily data for $DATE"

# 1. Get engine stats from state file
ENGINE_STATE="$HOME/kraken-intelligence/dryrun/engine_state.json"
if [ -f "$ENGINE_STATE" ]; then
    CAPITAL=$(jq -r '.capital // 0' "$ENGINE_STATE" 2>/dev/null)
    TRADES=$(jq -r '.trades | length' "$ENGINE_STATE" 2>/dev/null)
    POSITION=$(jq -r '.position // null' "$ENGINE_STATE" 2>/dev/null)
else
    CAPITAL=100
    TRADES=0
    POSITION="null"
fi

# 2. Get last 10 trades from log
LAST_TRADES=$(tail -50 "$HOME/cce/engines/four-red-days/dryrun.log" 2>/dev/null | grep -E "(ENTER|EXIT)" | tail -10 | jq -R -s -c 'split("\n")[:-1]')

# 3. Get current BTC price
BTC_PRICE=$(curl -s "https://api.kraken.com/0/public/Ticker?pair=XBTUSD" | jq -r '.result.XXBTZUSD.c[0] // 0' 2>/dev/null)

# 4. Get 4-red-day signal status
cd "$HOME/kraken-intelligence"
CANDLES=$(sqlite3 data/intelligence.db "SELECT close, open FROM candles WHERE pair='BTC/USD' AND interval='1D' ORDER BY timestamp DESC LIMIT 5;" 2>/dev/null)
CONSECUTIVE_RED=0
while IFS='|' read -r close open; do
    if (( $(echo "$close < $open" | bc -l 2>/dev/null) )); then
        ((CONSECUTIVE_RED++))
    else
        CONSECUTIVE_RED=0
    fi
done <<< "$CANDLES"
SIGNAL_ACTIVE=$([ $CONSECUTIVE_RED -ge 4 ] && echo "true" || echo "false")

# 5. Calculate daily performance metrics
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
YESTERDAY_FILE="$DAILY_DIR/${YESTERDAY}_report.json"
if [ -f "$YESTERDAY_FILE" ]; then
    YESTERDAY_CAPITAL=$(jq -r '.capital // 100' "$YESTERDAY_FILE" 2>/dev/null)
    DAILY_PNL=$(echo "$CAPITAL - $YESTERDAY_CAPITAL" | bc -l 2>/dev/null)
    DAILY_RETURN=$(echo "($CAPITAL - $YESTERDAY_CAPITAL) / $YESTERDAY_CAPITAL * 100" | bc -l 2>/dev/null)
else
    DAILY_PNL=0
    DAILY_RETURN=0
fi

# 6. Create report
cat > "$REPORT_FILE" << JSON
{
  "date": "$DATE",
  "timestamp": "$TIMESTAMP",
  "capital": $CAPITAL,
  "trades": $TRADES,
  "position": $POSITION,
  "btc_price": $BTC_PRICE,
  "signal_active": $SIGNAL_ACTIVE,
  "consecutive_red": $CONSECUTIVE_RED,
  "daily_pnl": $DAILY_PNL,
  "daily_return": $DAILY_RETURN,
  "last_trades": $LAST_TRADES
}
JSON

echo "✅ Report saved: $REPORT_FILE"
echo "   Capital: $${CAPITAL} | Trades: $TRADES | Signal: $SIGNAL_ACTIVE"

# Create symlink to latest report
ln -sf "$REPORT_FILE" "$DAILY_DIR/latest.json"

# Append to daily log (fixed formatting)
printf "%s | Capital: $%.2f | Trades: %d | Daily PnL: $%.2f | Return: %.2f%%\n" "$DATE" "$CAPITAL" "$TRADES" "$DAILY_PNL" "$DAILY_RETURN" >> "$REPORT_DIR/daily_log.txt"

echo "✅ Daily capture complete"
