#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const packagePath = join(root, 'package.json');
const workflowDir = join(root, '.github', 'workflows');
const errors = [];

let packageManager = '';
if (existsSync(packagePath)) {
  try {
    packageManager = JSON.parse(readFileSync(packagePath, 'utf8')).packageManager ?? '';
  } catch (error) {
    errors.push(`Cannot parse package.json: ${error.message}`);
  }
}

if (existsSync(workflowDir) && packageManager.startsWith('pnpm@')) {
  for (const file of readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))) {
    const path = join(workflowDir, file);
    const lines = readFileSync(path, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes('pnpm/action-setup@')) continue;
      for (let next = index + 1; next < Math.min(index + 8, lines.length); next += 1) {
        if (/^\s*-\s+(uses|name):/.test(lines[next])) break;
        const match = lines[next].match(/^\s+version:\s*([^#]+?)\s*$/);
        if (match) {
          errors.push(`${file}:${next + 1}: pnpm/action-setup version duplicates package.json packageManager (${match[1]} vs ${packageManager})`);
          break;
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log('GitHub workflow consistency checks passed.');
