#!/usr/bin/env node
const TreeCraft = require('./index');
const args = process.argv.slice(2);
const command = args[0];

const treecraft = new TreeCraft();

if (command === 'tree') {
  console.log('\n' + '═'.repeat(60));
  console.log('🌲 TREECRAFT — Project Structure Analysis');
  console.log('═'.repeat(60) + '\n');
  treecraft.analyzeStructure();
  console.log('\n' + '═'.repeat(60) + '\n');
} else if (command === 'deps') {
  console.log('\n' + '═'.repeat(60));
  console.log('🌲 TREECRAFT — Project Structure Analysis');
  console.log('═'.repeat(60));
  treecraft.findDependencies();
  console.log('\n' + '═'.repeat(60) + '\n');
} else if (command === 'all') {
  console.log('\n' + '═'.repeat(60));
  console.log('🌲 TREECRAFT — Project Structure Analysis');
  console.log('═'.repeat(60) + '\n');
  treecraft.analyzeStructure();
  treecraft.findDependencies();
  console.log('\n' + '═'.repeat(60) + '\n');
} else {
  console.log('\n' + '═'.repeat(60));
  console.log('🌲 TREECRAFT — Project Structure Analysis');
  console.log('═'.repeat(60));
  console.log('   Commands:');
  console.log('     node cli.js tree    Show project tree structure');
  console.log('     node cli.js deps    Show dependencies');
  console.log('     node cli.js all     Show everything');
  console.log('\n   Examples:');
  console.log('     node cli.js tree');
  console.log('     node cli.js all\n');
}
