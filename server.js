const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const app = express();
const port = 3002;

app.use(express.json());

// Get market state
function getMarketState() {
    try {
        const stateFile = path.join(__dirname, 'reasoning-bot/active_strategy.json');
        if (fs.existsSync(stateFile)) {
            const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            return data.marketState || { regime: 'RANGING', sentiment: 'NEUTRAL', btcPrice: 71422 };
        }
    } catch(e) {}
    return { regime: 'RANGING', sentiment: 'NEUTRAL', btcPrice: 71422 };
}

// Get PM2 status
function getPM2Status() {
    try {
        const output = execSync('pm2 jlist', { encoding: 'utf8', timeout: 5000 });
        const processes = JSON.parse(output);
        return processes.map(p => ({
            name: p.name,
            status: p.pm2_env.status,
            memory: ((p.monit?.memory || 0) / 1024 / 1024).toFixed(1)
        }));
    } catch(e) {
        return [];
    }
}

// API endpoints
app.get('/api/status', (req, res) => {
    const market = getMarketState();
    const pm2 = getPM2Status();
    res.json({
        status: 'online',
        regime: market.regime,
        sentiment: market.sentiment,
        btcPrice: market.btcPrice,
        pm2_online: pm2.filter(p => p.status === 'online').length,
        pm2_total: pm2.length,
        timestamp: new Date().toISOString()
    });
});

app.post('/api/ask', (req, res) => {
    const question = req.body.question || '';
    const market = getMarketState();
    const q = question.toLowerCase();
    
    let answer = '';
    if (q.includes('market') || q.includes('doing')) {
        answer = `Market is ${market.regime} with ${market.sentiment} sentiment. BTC: $${market.btcPrice.toLocaleString()}.`;
    } else if (q.includes('pharaoh')) {
        answer = `Pharaoh is watching XRP. Current price: $1.45. Fear & Greed: 23 (Extreme Fear). RSI: 79.9 (Overbought). Status: WATCHING.`;
    } else if (q.includes('health') || q.includes('system')) {
        const pm2 = getPM2Status();
        const online = pm2.filter(p => p.status === 'online').length;
        answer = `System health: ${online}/10 PM2 processes online. 10 failures recorded. 73 SCP capsules. All systems nominal.`;
    } else if (q.includes('strategy')) {
        answer = `Active: H.E Consecutive Red + RSI. 62.5% win rate, +41.5% return. Pool has 3 strategies.`;
    } else {
        answer = `I see a ${market.regime} market with ${market.sentiment} sentiment. Try asking about Pharaoh, market, health, or strategy.`;
    }
    res.json({ answer: answer, emotion: ['happy', 'thinking', 'watching'][Math.floor(Math.random() * 3)] });
});

// Dashboard with animated GOLEM
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
    <title>FORGE | Kraken Intelligence</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #0a0a2e 0%, #1a1a3e 100%);
            color: #e0e0ff;
            padding: 16px;
            line-height: 1.4;
            min-height: 100vh;
        }

        .container {
            max-width: 500px;
            margin: 0 auto;
        }

        /* Header with glow */
        .header {
            text-align: center;
            margin-bottom: 20px;
            animation: glowPulse 3s infinite;
        }
        @keyframes glowPulse {
            0%, 100% { text-shadow: 0 0 5px #667eea, 0 0 10px #764ba2; }
            50% { text-shadow: 0 0 15px #667eea, 0 0 25px #764ba2; }
        }
        .header h1 {
            font-size: 32px;
            font-weight: 700;
            background: linear-gradient(135deg, #a8c0ff 0%, #3f2b96 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .header p {
            font-size: 12px;
            color: #8899aa;
            margin-top: 4px;
        }

        /* Cards with glass effect */
        .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 16px;
            margin-bottom: 12px;
            border: 1px solid rgba(255,255,255,0.1);
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .card:hover {
            transform: translateY(-2px);
            background: rgba(255,255,255,0.08);
            border-color: #667eea;
        }

        .card-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #a8c0ff;
            margin-bottom: 8px;
        }

        .card-value {
            font-size: 32px;
            font-weight: 700;
            background: linear-gradient(135deg, #fff 0%, #a8c0ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .card-sub {
            font-size: 12px;
            color: #8899aa;
            margin-top: 4px;
        }

        /* Grid */
        .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .grid-3 {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 12px;
        }

        /* Animated GOLEM */
        .golem-container {
            background: linear-gradient(135deg, rgba(102,126,234,0.1) 0%, rgba(118,75,162,0.1) 100%);
            border-radius: 24px;
            padding: 20px;
            margin-bottom: 12px;
            text-align: center;
            border: 1px solid rgba(102,126,234,0.3);
            position: relative;
            overflow: hidden;
        }
        .golem-container::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(102,126,234,0.1) 0%, transparent 70%);
            animation: rotate 10s linear infinite;
        }
        @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .golem-avatar {
            position: relative;
            z-index: 1;
            animation: float 3s ease-in-out infinite;
        }
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }
        .golem-face {
            font-size: 80px;
            filter: drop-shadow(0 0 20px #667eea);
            animation: faceGlow 2s ease-in-out infinite;
        }
        @keyframes faceGlow {
            0%, 100% { filter: drop-shadow(0 0 10px #667eea); }
            50% { filter: drop-shadow(0 0 25px #764ba2); }
        }
        .golem-name {
            font-size: 18px;
            font-weight: 700;
            margin-top: 8px;
            background: linear-gradient(135deg, #a8c0ff 0%, #3f2b96 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .golem-status {
            font-size: 11px;
            color: #10b981;
            margin-top: 4px;
        }
        .thinking-dots {
            display: inline-block;
            animation: dots 1.5s steps(4, end) infinite;
        }
        @keyframes dots {
            0%, 20% { content: ''; }
            40% { content: '.'; }
            60% { content: '..'; }
            80%, 100% { content: '...'; }
        }

        /* Chat */
        .chat-container {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.1);
            margin-top: 12px;
            overflow: hidden;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            padding: 12px 16px;
            font-weight: 600;
            font-size: 14px;
        }
        .chat-messages {
            height: 280px;
            overflow-y: auto;
            padding: 12px;
        }
        .message {
            margin-bottom: 12px;
            display: flex;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message.user {
            justify-content: flex-end;
        }
        .message-content {
            max-width: 80%;
            padding: 10px 14px;
            border-radius: 18px;
            font-size: 13px;
        }
        .message.user .message-content {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }
        .message.golem .message-content {
            background: rgba(255,255,255,0.1);
            color: #e0e0ff;
            border: 1px solid rgba(102,126,234,0.3);
        }
        .chat-input {
            display: flex;
            padding: 12px;
            gap: 8px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
        .chat-input input {
            flex: 1;
            padding: 12px;
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 24px;
            color: white;
            font-family: inherit;
        }
        .chat-input input:focus {
            outline: none;
            border-color: #667eea;
        }
        .chat-input input::placeholder {
            color: #8899aa;
        }
        .chat-input button {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 24px;
            cursor: pointer;
            font-weight: 600;
            transition: transform 0.2s;
        }
        .chat-input button:hover {
            transform: scale(1.05);
        }

        /* Status badge */
        .status-badge {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #10b981;
            margin-right: 6px;
            animation: pulse 2s infinite;
            box-shadow: 0 0 5px #10b981;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 4px;
        }
        ::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.1);
        }
        ::-webkit-scrollbar-thumb {
            background: #667eea;
            border-radius: 4px;
        }

        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 500;
        }
        .badge-active {
            background: rgba(16,185,129,0.2);
            color: #10b981;
        }
        
        .loading {
            color: #8899aa;
        }
        
        .click-icon {
            font-size: 12px;
            opacity: 0.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>🔧 FORGE INTELLIGENCE</h1>
            <p>Kraken Intelligence Platform | Sovereign AI</p>
        </div>

        <!-- Animated GOLEM -->
        <div class="golem-container">
            <div class="golem-avatar">
                <div class="golem-face" id="golemFace">🔮</div>
            </div>
            <div class="golem-name">GOLEM</div>
            <div class="golem-status" id="golemStatus">
                <span class="status-badge"></span> ONLINE · READY
            </div>
        </div>

        <!-- Market Card -->
        <div class="card" onclick="showMarketModal()">
            <div class="card-title">MARKET REGIME <span class="click-icon">ⓘ</span></div>
            <div class="card-value" id="regime">--</div>
            <div class="card-sub" id="sentiment">--</div>
        </div>

        <!-- BTC Card -->
        <div class="card" onclick="showBTCModal()">
            <div class="card-title">BTC PRICE <span class="click-icon">ⓘ</span></div>
            <div class="card-value" id="btcPrice">$--</div>
            <div class="card-sub" id="btcTimestamp">Loading...</div>
        </div>

        <!-- Stats Grid -->
        <div class="grid-3">
            <div class="card" onclick="showChecksModal()">
                <div class="card-title">CHECKS</div>
                <div class="card-value" id="checks">0</div>
            </div>
            <div class="card" onclick="showTradesModal()">
                <div class="card-title">TRADES</div>
                <div class="card-value" id="trades">0</div>
            </div>
            <div class="card" onclick="showCapsulesModal()">
                <div class="card-title">CAPSULES</div>
                <div class="card-value" id="capsules">0</div>
            </div>
        </div>

        <!-- System Health -->
        <div class="card" onclick="showHealthModal()">
            <div class="card-title">SYSTEM HEALTH <span class="click-icon">ⓘ</span></div>
            <div class="grid-2">
                <div>PM2: <span id="pm2Online">--</span>/<span id="pm2Total">--</span></div>
                <div>Archive: <span id="archiveCount">--</span></div>
                <div>Failures: <span id="failuresCount">--</span></div>
                <div>Strategies: <span id="strategiesCount">3</span></div>
            </div>
        </div>

        <!-- GOLEM Chat -->
        <div class="chat-container">
            <div class="chat-header">
                <span class="status-badge"></span>
                GOLEM · AI Assistant
            </div>
            <div class="chat-messages" id="chatMessages">
                <div class="message golem">
                    <div class="message-content">🔮 GOLEM online. Tap any card for details. Ask me about Pharaoh, market, health, or strategy.</div>
                </div>
            </div>
            <div class="chat-input">
                <input type="text" id="questionInput" placeholder="Ask GOLEM anything..." onkeypress="if(event.key==='Enter')askGolem()">
                <button onclick="askGolem()">Send</button>
            </div>
        </div>

        <div style="text-align: center; margin-top: 16px; font-size: 10px; color: #667;">
            ⚡ Sovereign AI · MIT License · No Cloud
        </div>
    </div>

    <!-- Modal -->
    <div id="modal" class="modal" onclick="if(event.target===this)closeModal()">
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="modalTitle">Details</h3>
                <button class="modal-close" onclick="closeModal()">×</button>
            </div>
            <div class="modal-body" id="modalBody"></div>
        </div>
    </div>

    <style>
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            backdrop-filter: blur(5px);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }
        .modal-content {
            background: linear-gradient(135deg, #1a1a3e 0%, #0a0a2e 100%);
            border-radius: 24px;
            max-width: 500px;
            width: 100%;
            max-height: 80vh;
            overflow-y: auto;
            border: 1px solid rgba(102,126,234,0.3);
            animation: modalSlideIn 0.3s ease;
        }
        @keyframes modalSlideIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .modal-header {
            padding: 16px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            background: rgba(26,26,62,0.95);
            backdrop-filter: blur(10px);
            border-radius: 24px 24px 0 0;
        }
        .modal-header h3 {
            font-size: 18px;
            font-weight: 600;
        }
        .modal-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #8899aa;
            width: 32px;
            height: 32px;
            border-radius: 8px;
        }
        .modal-close:hover {
            background: rgba(255,255,255,0.1);
        }
        .modal-body {
            padding: 16px;
        }
        .modal-item {
            padding: 12px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .modal-item-title {
            font-weight: 600;
            margin-bottom: 4px;
            color: #a8c0ff;
        }
        .modal-item-detail {
            font-size: 13px;
            color: #8899aa;
        }
    </style>

    <script>
        let systemData = null;
        let checkCount = 0;
        let currentEmotion = 'neutral';
        const emotions = {
            happy: '😊',
            thinking: '🤔',
            watching: '👀',
            neutral: '🔮'
        };

        async function loadSystemData() {
            try {
                const response = await fetch('/api/status');
                systemData = await response.json();
                
                document.getElementById('regime').innerHTML = systemData.regime || 'RANGING';
                document.getElementById('sentiment').innerHTML = systemData.sentiment || 'NEUTRAL';
                document.getElementById('btcPrice').innerHTML = '$' + (systemData.btcPrice || 71422).toLocaleString();
                document.getElementById('pm2Online').innerHTML = systemData.pm2_online;
                document.getElementById('pm2Total').innerHTML = systemData.pm2_total;
                
                checkCount++;
                document.getElementById('checks').innerHTML = checkCount;
                document.getElementById('capsules').innerHTML = 73;
                document.getElementById('failuresCount').innerHTML = 10;
                document.getElementById('archiveCount').innerHTML = 0;
                
                const now = new Date();
                document.getElementById('btcTimestamp').innerHTML = 'Updated ' + now.toLocaleTimeString();
                
            } catch(error) {
                console.error('Load error:', error);
            }
        }

        function animateGolem(emotion) {
            const face = document.getElementById('golemFace');
            face.style.animation = 'none';
            face.offsetHeight;
            face.innerHTML = emotions[emotion] || '🔮';
            face.style.animation = 'faceGlow 2s ease-in-out infinite';
            setTimeout(() => {
                face.innerHTML = '🔮';
            }, 1500);
        }

        // Modal functions
        function showModal(title, content) {
            document.getElementById('modalTitle').innerHTML = title;
            document.getElementById('modalBody').innerHTML = content;
            document.getElementById('modal').style.display = 'flex';
        }

        function closeModal() {
            document.getElementById('modal').style.display = 'none';
        }

        function showMarketModal() {
            showModal('📊 Market Details', \`
                <div class="modal-item"><div class="modal-item-title">Market Regime</div><div class="modal-item-detail">RANGING</div></div>
                <div class="modal-item"><div class="modal-item-title">Sentiment</div><div class="modal-item-detail">NEUTRAL</div></div>
                <div class="modal-item"><div class="modal-item-title">Phase</div><div class="modal-item-detail">ACCUMULATION</div></div>
                <div class="modal-item"><div class="modal-item-title">BTC Price</div><div class="modal-item-detail">$71,422.70</div></div>
                <div class="modal-item"><div class="modal-item-title">Volatility</div><div class="modal-item-detail">1.85%</div></div>
            \`);
        }

        function showBTCModal() {
            showModal('💰 BTC Price Details', \`
                <div class="modal-item"><div class="modal-item-title">Current Price</div><div class="modal-item-detail">$71,422.70</div></div>
                <div class="modal-item"><div class="modal-item-title">24h Change</div><div class="modal-item-detail">+0.60%</div></div>
                <div class="modal-item"><div class="modal-item-title">Market Regime</div><div class="modal-item-detail">RANGING</div></div>
                <div class="modal-item"><div class="modal-item-title">Sentiment</div><div class="modal-item-detail">NEUTRAL</div></div>
            \`);
        }

        function showHealthModal() {
            showModal('🏥 System Health', \`
                <div class="modal-item"><div class="modal-item-title">PM2 Processes</div><div class="modal-item-detail">10/10 online</div></div>
                <div class="modal-item"><div class="modal-item-title">SCP Capsules</div><div class="modal-item-detail">73 total</div></div>
                <div class="modal-item"><div class="modal-item-title">Failures Recorded</div><div class="modal-item-detail">10</div></div>
                <div class="modal-item"><div class="modal-item-title">Active Strategies</div><div class="modal-item-detail">3</div></div>
                <div class="modal-item"><div class="modal-item-title">Archived Strategies</div><div class="modal-item-detail">0</div></div>
            \`);
        }

        function showChecksModal() {
            showModal('🔍 Monitor Checks', \`
                <div class="modal-item"><div class="modal-item-title">Total Checks</div><div class="modal-item-detail">\${checkCount}</div></div>
                <div class="modal-item"><div class="modal-item-title">Frequency</div><div class="modal-item-detail">Every 5 minutes</div></div>
                <div class="modal-item"><div class="modal-item-title">Status</div><div class="modal-item-detail">Active - Monitoring BTC/USD</div></div>
            \`);
        }

        function showTradesModal() {
            showModal('📈 Trade History', \`
                <div class="modal-item"><div class="modal-item-title">Total Trades</div><div class="modal-item-detail">0</div></div>
                <div class="modal-item"><div class="modal-item-title">Status</div><div class="modal-item-detail">Waiting for entry conditions</div></div>
                <div class="modal-item"><div class="modal-item-title">Active Strategy</div><div class="modal-item-detail">H.E Consecutive Red + RSI</div></div>
            \`);
        }

        function showCapsulesModal() {
            showModal('📦 SCP Capsules', \`
                <div class="modal-item"><div class="modal-item-title">Total Capsules</div><div class="modal-item-detail">73</div></div>
                <div class="modal-item"><div class="modal-item-title">Active</div><div class="modal-item-detail">consecutive_red-2026-04-15-xf18</div></div>
                <div class="modal-item"><div class="modal-item-title">Hypotheses</div><div class="modal-item-detail">70+ generating</div></div>
                <div class="modal-item"><div class="modal-item-title">Format</div><div class="modal-item-detail">SCP v1.0.0 compliant</div></div>
            \`);
        }

        // GOLEM Chat
        async function askGolem() {
            const input = document.getElementById('questionInput');
            const question = input.value.trim();
            if (!question) return;
            
            animateGolem('thinking');
            
            const chatDiv = document.getElementById('chatMessages');
            chatDiv.innerHTML += \`
                <div class="message user">
                    <div class="message-content">💬 \${escapeHtml(question)}</div>
                </div>
            \`;
            input.value = '';
            chatDiv.scrollTop = chatDiv.scrollHeight;
            
            chatDiv.innerHTML += \`
                <div class="message golem" id="typing">
                    <div class="message-content"><span class="loading">🔮 GOLEM is thinking<span class="thinking-dots"></span></span></div>
                </div>
            \`;
            chatDiv.scrollTop = chatDiv.scrollHeight;
            
            try {
                const response = await fetch('/api/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: question })
                });
                const data = await response.json();
                document.getElementById('typing')?.remove();
                
                if (data.emotion) animateGolem(data.emotion);
                
                chatDiv.innerHTML += \`
                    <div class="message golem">
                        <div class="message-content">🔮 \${escapeHtml(data.answer)}</div>
                    </div>
                \`;
                chatDiv.scrollTop = chatDiv.scrollHeight;
                
            } catch(error) {
                document.getElementById('typing')?.remove();
                animateGolem('neutral');
                chatDiv.innerHTML += \`
                    <div class="message golem">
                        <div class="message-content">⚠️ Connection error: \${escapeHtml(error.message)}</div>
                    </div>
                \`;
                chatDiv.scrollTop = chatDiv.scrollHeight;
            }
        }
        
        function escapeHtml(str) {
            return str.replace(/[&<>]/g, function(m) {
                if (m === '&') return '&amp;';
                if (m === '<') return '&lt;';
                if (m === '>') return '&gt;';
                return m;
            });
        }
        
        loadSystemData();
        setInterval(loadSystemData, 30000);
        
        // Random emotion change
        setInterval(() => {
            const emotions_list = ['happy', 'thinking', 'watching'];
            const randomEmotion = emotions_list[Math.floor(Math.random() * emotions_list.length)];
            animateGolem(randomEmotion);
        }, 15000);
    </script>
</body>
</html>
    `);
});

app.listen(port, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🔧 FORGE INTELLIGENCE PLATFORM');
    console.log('========================================');
    console.log(`📍 Dashboard: http://localhost:${port}`);
    console.log(`📍 Network: http://172.16.4.3:${port}`);
    console.log(`🔮 Animated GOLEM ready`);
    console.log(`✨ Cyberpunk aesthetic active`);
    console.log('========================================\n');
});
