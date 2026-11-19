import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTAINER_DIR = '/home/container/build-nodelink';
const TARGET_DIR = fs.existsSync(CONTAINER_DIR)
  ? CONTAINER_DIR
  : path.join(SCRIPT_DIR, 'build-nodelink');

if (!fs.existsSync(TARGET_DIR)) {
  console.error(`[VanillaSound] Directory not found: ${TARGET_DIR}`);
  process.exit(1);
}

const pkgPath = path.join(TARGET_DIR, 'package.json');
const distPkgPath = path.join(TARGET_DIR, 'dist', 'package.json');
if (!fs.existsSync(pkgPath) && fs.existsSync(distPkgPath)) {
  fs.copyFileSync(distPkgPath, pkgPath);
}

console.log(
  `[VanillaSound] Running npm install --omit=dev --allow-git=all --ignore-scripts in ${TARGET_DIR}...`
);

const result = spawnSync(
  'npm',
  ['install', '--omit=dev', '--allow-git=all', '--ignore-scripts', '--no-audit', '--no-fund'],
  {
    cwd: TARGET_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, npm_config_allow_git: 'all' }
  }
);

process.exit(result.status ?? 1);
