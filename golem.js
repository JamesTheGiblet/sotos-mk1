const express = require('express');
const app = express();
const port = 3002;

app.use(express.json());

// Status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        regime: 'RANGING',
        sentiment: 'NEUTRAL',
        btcPrice: 71422,
        timestamp: new Date().toISOString()
    });
});

// Ask endpoint
app.post('/api/ask', (req, res) => {
    const question = req.body.question || '';
    const q = question.toLowerCase();
    
    let answer = '';
    if (q.includes('market') || q.includes('doing')) {
        answer = 'Market is RANGING with NEUTRAL sentiment. BTC price is $71,422.';
    } else if (q.includes('trade')) {
        answer = 'Current regime is RANGING. Grid trading strategy is active. Entry conditions not met yet.';
    } else if (q.includes('strategy')) {
        answer = 'Active strategy: H.E Consecutive Red + RSI. Win rate: 62.5%. Return: +41.5%.';
    } else {
        answer = 'I see a RANGING market with NEUTRAL sentiment. Try asking about market, trade, or strategy.';
    }
    
    res.json({ answer: answer });
});

// Web interface
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>GOLEM - Kraken Intelligence</title>
    <style>
        body { background: #0a0a0a; color: #0f0; font-family: monospace; padding: 20px; }
        .chat { border: 1px solid #0f0; height: 400px; overflow: auto; padding: 10px; margin: 10px 0; }
        input { width: 70%; padding: 10px; background: #1a1a1a; color: #0f0; border: 1px solid #0f0; }
        button { padding: 10px; background: #0f0; color: #000; border: none; cursor: pointer; }
        .status { margin-bottom: 10px; }
    </style>
</head>
<body>
    <h1>🔮 GOLEM - Kraken Intelligence</h1>
    <div class="status" id="status">● Connecting...</div>
    <div class="chat" id="chat"></div>
    <input type="text" id="question" placeholder="Ask GOLEM anything..." onkeypress="if(event.key==='Enter')ask()">
    <button onclick="ask()">SEND</button>
    <script>
        async function updateStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                document.getElementById('status').innerHTML = '● ONLINE | ' + data.regime + ' | BTC: $' + data.btcPrice;
            } catch(e) {
                document.getElementById('status').innerHTML = '⚠️ OFFLINE';
            }
        }
        
        async function ask() {
            const input = document.getElementById('question');
            const q = input.value;
            if (!q) return;
            
            const chat = document.getElementById('chat');
            chat.innerHTML += '<div><b>You:</b> ' + q + '</div>';
            input.value = '';
            
            const res = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: q })
            });
            const data = await res.json();
            chat.innerHTML += '<div><b>GOLEM:</b> ' + data.answer + '</div>';
            chat.scrollTop = chat.scrollHeight;
        }
        
        updateStatus();
        setInterval(updateStatus, 30000);
    </script>
</body>
</html>
    `);
});

app.listen(port, '0.0.0.0', () => {
    console.log('GOLEM running on port ' + port);
    console.log('Open http://localhost:' + port);
});
