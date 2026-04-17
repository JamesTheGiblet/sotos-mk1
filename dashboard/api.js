#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const REPORT_DIR = path.join(process.env.HOME, 'kraken-intelligence/reports/daily');
const ENGINE_STATE = path.join(process.env.HOME, 'kraken-intelligence/dryrun/engine_state.json');
const DAILY_LOG = path.join(process.env.HOME, 'kraken-intelligence/reports/daily_log.txt');

function getLatestReport() {
    const latestFile = path.join(REPORT_DIR, 'latest.json');
    if (fs.existsSync(latestFile)) {
        try {
            return JSON.parse(fs.readFileSync(latestFile, 'utf8'));
        } catch (e) {
            return null;
        }
    }
    return null;
}

function getEngineState() {
    if (fs.existsSync(ENGINE_STATE)) {
        try {
            return JSON.parse(fs.readFileSync(ENGINE_STATE, 'utf8'));
        } catch (e) {
            return null;
        }
    }
    return null;
}

function getCapitalHistory() {
    const reports = fs.readdirSync(REPORT_DIR)
        .filter(f => f.endsWith('_report.json') && f !== 'latest.json')
        .sort()
        .map(f => {
            const data = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8'));
            return {
                date: data.date,
                capital: data.capital
            };
        });
    
    // Add current if not in reports
    const latest = getLatestReport();
    if (latest && !reports.find(r => r.date === latest.date)) {
        reports.push({ date: latest.date, capital: latest.capital });
    }
    
    return reports;
}

function getDailyLog() {
    if (!fs.existsSync(DAILY_LOG)) return [];
    
    const lines = fs.readFileSync(DAILY_LOG, 'utf8').trim().split('\n');
    return lines.map(line => {
        const match = line.match(/(\d{4}-\d{2}-\d{2}) \| Capital: \$([\d.]+) \| Trades: \d+ \| Daily PnL: \$([\d.]+) \| Return: ([\d.-]+)%/);
        if (match) {
            return {
                date: match[1],
                capital: parseFloat(match[2]),
                daily_pnl: parseFloat(match[3]),
                daily_return: parseFloat(match[4])
            };
        }
        return null;
    }).filter(l => l);
}

function getRecentTrades() {
    const state = getEngineState();
    if (state && state.trades) {
        return state.trades.slice(-10).reverse();
    }
    return [];
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    
    if (req.url === '/api/status') {
        const report = getLatestReport();
        const state = getEngineState();
        const trades = getRecentTrades();
        
        const wins = state ? state.trades.filter(t => t.win).length : 0;
        const losses = state ? state.trades.filter(t => !t.win).length : 0;
        const avgWin = wins > 0 ? state.trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0) / wins : 0;
        const avgLoss = losses > 0 ? state.trades.filter(t => !t.win).reduce((s, t) => s + t.pnlPct, 0) / losses : 0;
        
        const response = {
            capital: report ? report.capital : 100,
            trades: report ? report.trades : 0,
            wins: wins,
            losses: losses,
            win_rate: (wins + losses) > 0 ? (wins / (wins + losses) * 100) : 0,
            avg_win: avgWin,
            avg_loss: Math.abs(avgLoss),
            btc_price: report ? report.btc_price : 0,
            consecutive_red: report ? report.consecutive_red : 0,
            signal_active: report ? report.signal_active : false,
            capital_history: getCapitalHistory(),
            recent_trades: trades,
            daily_log: getDailyLog()
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
    } 
    else if (req.url === '/' || req.url === '/index.html') {
        const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`📊 Four Red Days Dashboard`);
    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`  API: http://localhost:${PORT}/api/status`);
    console.log(`════════════════════════════════════════════════════════════\n`);
});
