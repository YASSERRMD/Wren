#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EM_DASH = String.fromCharCode(0x2014);
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.yml',
  '.yaml',
]);

function trackedAndUntrackedFiles() {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

function hasTextExtension(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot));
}

const offenders = [];

for (const file of trackedAndUntrackedFiles()) {
  if (!hasTextExtension(file)) continue;
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.includes(EM_DASH)) {
      offenders.push(`${file}:${index + 1}`);
    }
  });
}

if (offenders.length > 0) {
  console.error('Em dash character found in:');
  for (const offender of offenders) {
    console.error(`  ${offender}`);
  }
  process.exit(1);
}

console.log('No em dash characters found.');
