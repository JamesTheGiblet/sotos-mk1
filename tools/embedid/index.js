#!/usr/bin/env node
/**
 * EmbedID — Code Watermarking & Provenance Tracking
 * Part of the Adaptive Intelligence Platform
 * License: MIT
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class EmbedID {
  constructor() {
    this.watermarkDir = path.join(process.env.HOME, 'kraken-intelligence', 'watermarks');
    if (!fs.existsSync(this.watermarkDir)) {
      fs.mkdirSync(this.watermarkDir, { recursive: true });
    }
  }

  generateFingerprint(strategyId, metadata) {
    const data = JSON.stringify({
      strategyId,
      timestamp: new Date().toISOString(),
      metadata,
      random: crypto.randomBytes(16).toString('hex')
    });
    
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    const fingerprint = hash.substring(0, 16);
    
    return {
      fingerprint,
      hash,
      timestamp: new Date().toISOString(),
      strategyId,
      metadata
    };
  }

  embedWatermark(code, fingerprint) {
    const watermark = `// 🔒 EMBEDID WATERMARK
// Fingerprint: ${fingerprint.fingerprint}
// Strategy: ${fingerprint.strategyId}
// Generated: ${fingerprint.timestamp}
// Hash: ${fingerprint.hash.substring(0, 16)}
// This code is watermarked and tracked by EmbedID
// Do not remove this watermark

`;
    return watermark + code;
  }

  extractWatermark(code) {
    const lines = code.split('\n');
    const watermark = {};
    
    for (let i = 0; i < lines.length && i < 10; i++) {
      if (lines[i].includes('Fingerprint:')) {
        watermark.fingerprint = lines[i].split(':')[1].trim();
      } else if (lines[i].includes('Strategy:')) {
        watermark.strategyId = lines[i].split(':')[1].trim();
      } else if (lines[i].includes('Generated:')) {
        watermark.timestamp = lines[i].split(':').slice(1).join(':').trim();
      } else if (lines[i].includes('Hash:')) {
        watermark.hash = lines[i].split(':')[1].trim();
      }
    }
    
    return Object.keys(watermark).length > 0 ? watermark : null;
  }

  saveWatermark(fingerprint) {
    const recordFile = path.join(this.watermarkDir, `${fingerprint.fingerprint}.json`);
    fs.writeFileSync(recordFile, JSON.stringify(fingerprint, null, 2));
    return recordFile;
  }

  verifyWatermark(code) {
    const extracted = this.extractWatermark(code);
    if (!extracted) return { valid: false, reason: 'No watermark found' };
    
    const recordFile = path.join(this.watermarkDir, `${extracted.fingerprint}.json`);
    if (!fs.existsSync(recordFile)) {
      return { valid: false, reason: 'Watermark not registered' };
    }
    
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    const valid = record.fingerprint === extracted.fingerprint &&
                  record.strategyId === extracted.strategyId;
    
    return { valid, record, extracted };
  }

  watermarkSCPCapsule(capsulePath, strategyId) {
    const capsuleFile = path.join(capsulePath, 'capsule.json');
    if (!fs.existsSync(capsuleFile)) {
      return { error: 'Capsule not found' };
    }
    
    const capsule = JSON.parse(fs.readFileSync(capsuleFile, 'utf8'));
    const fingerprint = this.generateFingerprint(strategyId, {
      type: capsule.manifest.type,
      parameters: capsule.manifest.parameters
    });
    
    // Add watermark to capsule
    capsule.watermark = fingerprint;
    capsule.manifest.watermarkFingerprint = fingerprint.fingerprint;
    
    fs.writeFileSync(capsuleFile, JSON.stringify(capsule, null, 2));
    this.saveWatermark(fingerprint);
    
    return { success: true, fingerprint };
  }
}

module.exports = EmbedID;
