import { spawnSync } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

dns.setDefaultResultOrder('ipv4first');

const OWNER = 'Elaina2026';
const REPO = 'VanillaSound';
const BRANCH = 'main';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = fs.existsSync('/home/container') ? '/home/container' : SCRIPT_DIR;

const KEEP_FILES = new Set([
  'index.js',
  'package.json',
  'package-lock.json',
  '.env.example',
  'README.md',
  'start.sh',
  'start-all.mjs',
  'data/.gitkeep'
]);

/**
 * Extracts needed bot files from an uncompressed POSIX tar buffer into destDir.
 * Preserves existing .env, data/247.json, and build-nodelink/.
 * @param {Buffer} tarBuffer
 * @param {string} destDir
 * @returns {number}
 */
function extractTarToDir(tarBuffer, destDir) {
  let offset = 0;
  let count = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const rawPrefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const fullName = rawPrefix ? `${rawPrefix}/${rawName}` : rawName;
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const fileSize = sizeOctal ? Number.parseInt(sizeOctal, 8) : 0;
    const typeFlag = String.fromCharCode(header[156] || 48);

    offset += 512;
    const dataEnd = offset + fileSize;
    const paddedSize = Math.ceil(fileSize / 512) * 512;

    if (typeFlag === '0' || typeFlag === '\0') {
      const slashIndex = fullName.indexOf('/');
      const relPath = slashIndex >= 0 ? fullName.slice(slashIndex + 1) : fullName;

      if (relPath && (KEEP_FILES.has(relPath) || relPath.startsWith('src/'))) {
        const outPath = path.join(destDir, ...relPath.split('/'));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, tarBuffer.subarray(offset, dataEnd));
        count += 1;
      }
    }

    offset += paddedSize;
  }

  return count;
}

/**
 * Downloads the repository tarball via GitHub API (supports private repos with GITHUB_TOKEN).
 * @param {string} token
 * @returns {Promise<Buffer>}
 */
async function downloadTarball(token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/tarball/${BRANCH}`;
  const headers = {
    'User-Agent': 'VanillaSound-Setup/1.0',
    Accept: 'application/vnd.github+json'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  console.log(`[VanillaSound] Downloading repository archive from GitHub...`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers
  });

  if (response.status === 404 || response.status === 401 || response.status === 403) {
    throw new Error(
      `GitHub returned HTTP ${response.status}. Repository "${OWNER}/${REPO}" is private or unreachable. ` +
        'Set GITHUB_TOKEN=<your_token> (or pass it as an argument: node setup-bot.mjs <token>), ' +
        'make the repository Public, or upload index.js + src/ + package.json directly.'
    );
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const gzBuffer = Buffer.from(await response.arrayBuffer());
  console.log(`[VanillaSound] Downloaded ${(gzBuffer.length / 1024).toFixed(1)} KB. Extracting...`);
  return zlib.gunzipSync(gzBuffer);
}

async function main() {
  const token = (process.argv[2] || process.env.GITHUB_TOKEN || '').trim();
  const tarBuffer = await downloadTarball(token);
  const extracted = extractTarToDir(tarBuffer, TARGET_DIR);

  if (extracted === 0) {
    throw new Error('No bot files were extracted from the archive.');
  }

  console.log(`[VanillaSound] Extracted ${extracted} file(s) into ${TARGET_DIR}.`);
  console.log('[VanillaSound] Installing bot dependencies...');

  const install = spawnSync(
    'npm',
    ['install', '--omit=dev', '--no-audit', '--no-fund'],
    {
      cwd: TARGET_DIR,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    }
  );

  if (install.status !== 0) {
    throw new Error(`npm install failed with code ${install.status ?? 'unknown'}`);
  }

  console.log(`[VanillaSound] Done! Ready in ${TARGET_DIR}. Run: node start-all.mjs`);
}

main().catch((error) => {
  console.error(
    '[VanillaSound] Setup failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
