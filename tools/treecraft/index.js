#!/usr/bin/env node
/**
 * TreeCraft — Project Structure Analysis
 * Part of the Adaptive Intelligence Platform
 * License: MIT
 */

const fs = require('fs');
const path = require('path');

class TreeCraft {
  constructor(rootPath = null) {
    this.rootPath = rootPath || path.join(process.env.HOME, 'kraken-intelligence');
    this.tree = {};
  }

  generateTree(dirPath = this.rootPath, prefix = '', isLast = true) {
    const stats = fs.statSync(dirPath);
    const basename = path.basename(dirPath);
    
    let output = '';
    output += prefix;
    output += isLast ? '└── ' : '├── ';
    output += basename;
    if (stats.isDirectory()) output += '/';
    output += '\n';
    
    if (stats.isDirectory()) {
      const children = fs.readdirSync(dirPath)
        .filter(name => !name.startsWith('.') && name !== 'node_modules')
        .sort();
      
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      for (let i = 0; i < children.length; i++) {
        const childPath = path.join(dirPath, children[i]);
        const childIsLast = i === children.length - 1;
        output += this.generateTree(childPath, newPrefix, childIsLast);
      }
    }
    
    return output;
  }

  analyzeStructure() {
    console.log('📁 Project Structure:\n');
    console.log(this.generateTree());
    
    // Count files by type
    const stats = this.countFiles(this.rootPath);
    console.log('\n📊 File Statistics:');
    console.log(`  Total files: ${stats.total}`);
    console.log(`  JavaScript: ${stats.js}`);
    console.log(`  JSON: ${stats.json}`);
    console.log(`  Markdown: ${stats.md}`);
    console.log(`  Other: ${stats.other}`);
    
    return { tree: this.generateTree(), stats };
  }

  countFiles(dirPath) {
    let stats = { total: 0, js: 0, json: 0, md: 0, other: 0 };
    
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      if (item.startsWith('.') || item === 'node_modules') continue;
      
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        const subStats = this.countFiles(itemPath);
        stats.total += subStats.total;
        stats.js += subStats.js;
        stats.json += subStats.json;
        stats.md += subStats.md;
        stats.other += subStats.other;
      } else {
        stats.total++;
        const ext = path.extname(item).toLowerCase();
        if (ext === '.js') stats.js++;
        else if (ext === '.json') stats.json++;
        else if (ext === '.md') stats.md++;
        else stats.other++;
      }
    }
    
    return stats;
  }

  findDependencies() {
    const packageFile = path.join(this.rootPath, 'package.json');
    if (!fs.existsSync(packageFile)) {
      return { error: 'package.json not found' };
    }
    
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    console.log('\n📦 Dependencies:');
    for (const [name, version] of Object.entries(deps).slice(0, 10)) {
      console.log(`  ${name}: ${version}`);
    }
    
    return deps;
  }
}

module.exports = TreeCraft;
