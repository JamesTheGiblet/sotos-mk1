#!/bin/bash

# Daily dry run at 7am UTC (after data collection)
# Run: crontab -e
# Add: 0 7 * * * /data/data/com.termux/files/home/kraken-intelligence/dryrun/scheduler.sh

echo "========================================"
echo "Dry Run Scheduler - $(date)"
echo "========================================"

cd ~/kraken-intelligence

# Run dry run backtest
node dryrun/backtest.js

# Run comparison to see if strategies are still performing
node cli.js compare >> dryrun/daily_report.txt

echo "Daily dry run complete - $(date)" >> dryrun/daily_report.txt
echo "" >> dryrun/daily_report.txt

echo "Done"
