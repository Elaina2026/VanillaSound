import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = 'https://github.com/Elaina2026/VanillaSound.git';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = fs.existsSync('/home/container') ? '/home/container' : SCRIPT_DIR;

/**
 * Recursively copies a directory without overwriting preserved paths.
 * @param {string} src
 * @param {string} dest
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function runCommand(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanillasound-'));
  console.log(`[VanillaSound] Downloading bot files into ${TARGET_DIR}...`);

  try {
    const clone = runCommand('git', ['clone', '--depth', '1', REPO_URL, tmpDir], TARGET_DIR);
    if (clone.status !== 0) {
      throw new Error(`git clone failed with code ${clone.status ?? 'unknown'}`);
    }

    const filesToCopy = [
      'index.js',
      'package.json',
      'package-lock.json',
      '.env.example',
      'README.md',
      'start.sh'
    ];

    for (const file of filesToCopy) {
      const srcFile = path.join(tmpDir, file);
      const destFile = path.join(TARGET_DIR, file);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
      }
    }

    const srcCodeDir = path.join(tmpDir, 'src');
    if (fs.existsSync(srcCodeDir)) {
      copyDir(srcCodeDir, path.join(TARGET_DIR, 'src'));
    }

    const dataDir = path.join(TARGET_DIR, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const gitkeepSrc = path.join(tmpDir, 'data', '.gitkeep');
    if (fs.existsSync(gitkeepSrc)) {
      fs.copyFileSync(gitkeepSrc, path.join(dataDir, '.gitkeep'));
    }

    console.log('[VanillaSound] Installing bot dependencies...');
    const install = runCommand(
      'npm',
      ['install', '--omit=dev', '--no-audit', '--no-fund'],
      TARGET_DIR
    );
    if (install.status !== 0) {
      throw new Error(`npm install failed with code ${install.status ?? 'unknown'}`);
    }

    console.log(`[VanillaSound] Done! index.js and src/ are ready in ${TARGET_DIR}.`);
    console.log('[VanillaSound] You can now run: node start-all.mjs');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(
    '[VanillaSound] Setup failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
}
