#!/usr/bin/env node
const TreeCraft = require('./index');
const args = process.argv.slice(2);
const command = args[0];

const treecraft = new TreeCraft();

if (command === 'tree') {
  treecraft.analyzeStructure();
} else if (command === 'deps') {
  treecraft.findDependencies();
} else if (command === 'all') {
  treecraft.analyzeStructure();
  treecraft.findDependencies();
} else {
  console.log(`
TreeCraft — Project Structure Analysis

Commands:
  node cli.js tree    Show project tree structure
  node cli.js deps    Show dependencies
  node cli.js all     Show everything

Examples:
  node cli.js tree
  node cli.js all
`);
}
