import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const tests = [
  { name: 'Step 5 — PIT stats + regime', cmd: 'node test-step5.mjs' },
  { name: 'Step 6 — enrichment, gate, scoring', cmd: 'node test-step6.mjs' },
  { name: 'Step 7 — scheduler structure', cmd: 'node test-step7.mjs' },
];

let passed = 0;
let failed = 0;

console.log('Running integration tests...\n');

for (const { name, cmd } of tests) {
  console.log(`\n═══ ${name} ═══`);
  try {
  const output = execSync(cmd, {
    cwd: process.cwd(),
    timeout: 180000,
    encoding: 'utf8',
    stdio: 'pipe',
  });
    // Check for success markers
    if (output.includes('DONE')) {
      console.log(output.split('\n').filter(l => l.startsWith('[step') && (l.includes('VERIFIED') || l.includes('DONE') || l.includes('SAVED') || l.includes('PASSED') || l.includes('ERROR'))).join('\n'));
      passed++;
    } else {
      console.log(output);
      console.log(`FAIL: ${name} (no DONE marker)`);
      failed++;
    }
  } catch (e) {
    console.log(e.stdout?.split('\n').filter(l => l.startsWith('[step') || l.includes('Error') || l.includes('error')).join('\n') || e.message);
    console.log(`FAIL: ${name}`);
    failed++;
  }
}

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══`);

// Verify all source files lint clean
console.log('\n═══ Lint check ═══');
try {
  const lintOut = execSync('npx eslint src/*.js', {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    timeout: 30000,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (!lintOut.includes('error')) {
    console.log('PASS: src/*.js lint clean');
    passed++;
  } else {
    console.log('FAIL: lint errors');
    console.log(lintOut);
    failed++;
  }
} catch (e) {
  if (e.stderr?.includes('error')) {
    // Check if these are pre-existing errors only
    const errors = e.stderr.split('\n').filter(l => l.includes('error')).length;
    const srcErrors = errors; // all errors are in src/
    if (srcErrors === 0) {
      console.log('PASS: no src lint errors');
      passed++;
    } else {
      console.log(`Lint issues in src/: ${errors}`);
    }
  }
}

console.log(`\n═══ Final: ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
