import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignoredDirectories = new Set(['.git', 'node_modules']);
const sourceFiles = [];

function collectFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(file);
    else sourceFiles.push(file);
  }
}

collectFiles(root);
const filesToCheck = sourceFiles.filter((file) => /\.(?:js|mjs|cjs|json)$/.test(file) || file.endsWith('.webmanifest'));
let failures = 0;

for (const file of filesToCheck) {
  const label = relative(root, file);
  if (/\.(?:js|mjs|cjs)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures += 1;
      process.stderr.write('FAIL ' + label + '\n' + (result.stderr || result.error?.message || 'Syntax check failed') + '\n');
      continue;
    }
  } else {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      failures += 1;
      process.stderr.write('FAIL ' + label + '\n' + error.message + '\n');
      continue;
    }
  }
  process.stdout.write('PASS ' + label + '\n');
}

if (failures > 0) {
  process.stderr.write('\n' + failures + ' check(s) failed.\n');
  process.exitCode = 1;
} else {
  process.stdout.write('\nAll ' + filesToCheck.length + ' checks passed.\n');
}
