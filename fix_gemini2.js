#!/usr/bin/env node
const fs = require('fs');
let content = fs.readFileSync('forge-dashboard.js', 'utf8');

// Find the askGemini function and replace it entirely
const start = content.indexOf('async function askGemini(');
if (start === -1) { console.log('Could not find askGemini'); process.exit(1); }

// Find end of function
let depth = 0, end = start;
for (let i = start; i < content.length; i++) {
  if (content[i] === '{') depth++;
  else if (content[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}

const newFn = `async function askGemini(message, systemContext) {
  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: systemContext + '\\n\\nUser: ' + message
    });
    return response.text || 'No response from model';
  } catch (e) {
    console.error('Gemini error:', e.message);
    return 'API error: ' + e.message;
  }
}`;

content = content.slice(0, start) + newFn + content.slice(end);
fs.writeFileSync('forge-dashboard.js', content);
console.log('Replaced askGemini with new SDK version');
console.log('Model: gemini-2.5-flash');
