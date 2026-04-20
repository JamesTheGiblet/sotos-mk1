const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

console.log('\n🔍 --- ENV DIAGNOSTIC TEST ---');
console.log('1. __dirname:   ', __dirname);
console.log('2. process.cwd():', process.cwd());

const envPath = path.join(__dirname, '.env');
const envTxtPath = path.join(__dirname, '.env.txt');

console.log('\n3. Looking for .env file at:', envPath);
console.log('   Exists?', fs.existsSync(envPath) ? '✅ YES' : '❌ NO');

console.log('\n4. Looking for .env.txt file at:', envTxtPath);
console.log('   Exists?', fs.existsSync(envTxtPath) ? '⚠️ YES (Windows hid the extension!)' : '❌ NO');

if (fs.existsSync(envPath) || fs.existsSync(envTxtPath)) {
  const targetPath = fs.existsSync(envPath) ? envPath : envTxtPath;
  const content = fs.readFileSync(targetPath, 'utf8');
  console.log('\n5. Raw File Contents (from ' + path.basename(targetPath) + '):');
  content.split('\n').forEach((line, i) => {
    let masked = line;
    if (line.includes('AIzaSy')) {
      masked = line.replace(/AIzaSy[a-zA-Z0-9_-]+/g, 'AIzaSy***MASKED***');
    }
    const showInvisibles = masked.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    console.log(`   Line ${i + 1}: "${showInvisibles}" (Length: ${line.length})`);
  });
}

console.log('\n6. process.env.GEMINI_API_KEY:');
if (process.env.GEMINI_API_KEY) {
  console.log(`   ✅ EXISTS! Starts with: ${process.env.GEMINI_API_KEY.substring(0, 10)}...`);
} else {
  console.log('   ❌ UNDEFINED OR EMPTY');
}
console.log('------------------------------\n');