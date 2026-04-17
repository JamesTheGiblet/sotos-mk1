const fs = require('fs');
const d = JSON.parse(fs.readFileSync('scp-capsule-share.json', 'utf8'));

if (!d.pending_integrations) d.pending_integrations = [];

d.pending_integrations.push({
  name: 'auth-system',
  description: 'Production-ready JWT authentication backend',
  repo: 'https://github.com/JamesTheGiblet/auth-system',
  stack: ['Node.js', 'Express.js', 'MongoDB', 'Jest'],
  features: ['JWT with refresh tokens', 'bcrypt password hashing', 'rate limiting', 'email verification', 'CORS', 'Helmet.js'],
  when_needed: 'When a web dashboard or external API is built',
  dependency_note: 'Requires MongoDB — current stack uses SQLite only',
  status: 'pending'
});

d.manifest.version = '1.2.3';
d.lifecycle.last_updated = new Date().toISOString();
fs.writeFileSync('scp-capsule-share.json', JSON.stringify(d, null, 2));
console.log('Auth System added as pending integration');
