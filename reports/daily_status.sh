#!/bin/bash

# Quick daily status display

REPORT_DIR="$HOME/kraken-intelligence/reports"
DAILY_DIR="$REPORT_DIR/daily"
LATEST="$DAILY_DIR/latest.json"

if [ ! -f "$LATEST" ]; then
    echo "❌ No report found. Run daily_capture.sh first."
    exit 1
fi

clear
echo ""
echo "════════════════════════════════════════════════════════════"
echo "📊 Four Red Days — Daily Status"
echo "════════════════════════════════════════════════════════════"
echo ""

DATE=$(jq -r '.date' "$LATEST")
CAPITAL=$(jq -r '.capital' "$LATEST")
TRADES=$(jq -r '.trades' "$LATEST")
BTC_PRICE=$(jq -r '.btc_price' "$LATEST")
SIGNAL=$(jq -r '.signal_active' "$LATEST")
CONSECUTIVE=$(jq -r '.consecutive_red' "$LATEST")
DAILY_PNL=$(jq -r '.daily_pnl' "$LATEST")
DAILY_RETURN=$(jq -r '.daily_return' "$LATEST")

echo "  Date:          $DATE"
echo "  BTC Price:     \$$BTC_PRICE"
echo "  Capital:       \$$CAPITAL"
echo "  Trades:        $TRADES"
echo "  Daily P&L:     \$$DAILY_PNL (${DAILY_RETURN}%)"
echo "  Signal:        $SIGNAL (${CONSECUTIVE} red days)"
echo ""

# Show last 3 trades
echo "  Recent Trades:"
jq -r '.last_trades[]' "$LATEST" 2>/dev/null | tail -6 | while read line; do
    echo "    $line"
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Next: Run '~/kraken-intelligence/reports/daily_capture.sh' after 6am UTC"
echo "════════════════════════════════════════════════════════════"
