const fs = require('fs');
let c = fs.readFileSync('forge-dashboard.js', 'utf8');

const oldFn = `async function askGemini(message, systemContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return 'Gemini API key not configured.';

  const body = JSON.stringify({
    contents: [{
      parts: [{
        text: systemContext + '\\n\\nUser: ' + message
      }]
    }],
    generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
  });

  return new Promise(resolve => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path:     '/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
          resolve(text);
        } catch (e) { resolve('Error parsing response'); }
      });
    });
    req.on('error', e => resolve('API error: ' + e.message));
    req.write(body);
    req.end();
  });
}`;

const newFn = `async function askGemini(message, systemContext) {
  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-04-17',
      contents: systemContext + '\\n\\nUser: ' + message
    });
    return response.text || 'No response';
  } catch (e) {
    return 'API error: ' + e.message;
  }
}`;

if (c.includes('gemini-1.5-flash:generateContent') || c.includes('gemini-pro:generateContent')) {
  c = c.replace(oldFn, newFn);
  fs.writeFileSync('forge-dashboard.js', c);
  console.log('Updated to new Gemini SDK');
} else {
  console.log('Could not find old function — replacing just the model call');
  c = c.replace(/gemini-[^:'"]+(:generateContent)?/g, 'gemini-2.5-flash-preview-04-17');
  fs.writeFileSync('forge-dashboard.js', c);
  console.log('Updated model name');
}
