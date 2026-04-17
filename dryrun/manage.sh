#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/monitor.pid"
LOG_FILE="$SCRIPT_DIR/monitor.log"

start() {
    if pgrep -f "live_monitor.js" > /dev/null; then
        echo "Monitor is already running"
        return 1
    fi
    cd "$SCRIPT_DIR"
    nohup node live_monitor.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Monitor started (PID: $!)"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        kill $(cat "$PID_FILE") 2>/dev/null
        rm "$PID_FILE"
    fi
    pkill -f "live_monitor.js" 2>/dev/null
    echo "Monitor stopped"
}

status() {
    if pgrep -f "live_monitor.js" > /dev/null; then
        echo "Monitor is running"
        ps aux | grep live_monitor | grep -v grep
    else
        echo "Monitor is not running"
    fi
}

restart() {
    stop
    sleep 2
    start
}

logs() {
    tail -f "$LOG_FILE"
}

case "$1" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    logs)    logs ;;
    *)       echo "Usage: $0 {start|stop|restart|status|logs}" ;;
esac
