import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKOFF_INITIAL_MS = 3_000;
const BACKOFF_MAX_MS = 30_000;
const STABLE_RESET_MS = 300_000;
const READY_TIMEOUT_MS = 60_000;

let stopping = false;
const activeChildren = new Set();

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

function logSupervisor(message) {
  console.log(`[VanillaSound] [${timestamp()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finds the VanillaSound bot directory containing index.js.
 * @returns {string}
 */
function resolveBotDir() {
  const candidates = [
    process.env.BOT_DIR?.trim(),
    ROOT_DIR,
    path.join(ROOT_DIR, 'VanillaSound')
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.js'))) {
      return dir;
    }
  }
  return ROOT_DIR;
}

/**
 * Finds the NodeLink directory from env or common project paths.
 * @param {string} botDir
 * @returns {string}
 */
function resolveNodelinkDir(botDir) {
  const candidates = [
    process.env.NODELINK_DIR?.trim(),
    path.join(ROOT_DIR, 'build-nodelink'),
    path.join(botDir, 'build-nodelink'),
    path.join(ROOT_DIR, 'NodeLink'),
    path.join(botDir, 'NodeLink'),
    path.resolve(ROOT_DIR, '..', 'NodeLink')
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

/**
 * Determines the NodeLink entrypoint and Node arguments.
 * @param {string} nlDir
 * @returns {string[]}
 */
function resolveNodelinkArgs(nlDir) {
  const baseFlags = ['--max-old-space-size=512', '--dns-result-order=ipv4first'];

  const distEntry = path.join(nlDir, 'dist', 'src', 'index.js');
  if (fs.existsSync(distEntry)) {
    return [...baseFlags, distEntry];
  }

  const tsEntry = path.join(nlDir, 'src', 'index.ts');
  if (fs.existsSync(tsEntry)) {
    return [...baseFlags, '--experimental-strip-types', tsEntry];
  }

  const legacyEntry = path.join(nlDir, 'src', 'connection', 'index.js');
  if (fs.existsSync(legacyEntry)) {
    return [...baseFlags, legacyEntry];
  }

  throw new Error(`NodeLink entrypoint not found in ${nlDir}`);
}

/**
 * Reads NODELINK_URL from .env (if present) and returns host and port.
 * @param {string} botDir
 * @returns {{ host: string, port: number }}
 */
function readNodelinkAddress(botDir) {
  let raw = process.env.NODELINK_URL || '';
  const envCandidates = [path.join(botDir, '.env'), path.join(ROOT_DIR, '.env')];
  for (const envPath of envCandidates) {
    if (!raw && fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*NODELINK_URL\s*=\s*(.+?)\s*$/);
        if (match) {
          raw = match[1].replace(/^['"]|['"]$/g, '');
        }
      }
    }
  }

  const cleaned = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^wss?:\/\//i, '')
    .replace(/\/.*$/, '')
    .trim();

  if (!cleaned) {
    return { host: '127.0.0.1', port: 2333 };
  }

  const [hostPart, portPart] = cleaned.split(':');
  const port = Number.parseInt(portPart || '2333', 10);
  return {
    host: hostPart || '127.0.0.1',
    port: Number.isFinite(port) && port > 0 ? port : 2333
  };
}

/**
 * Probes a TCP port once.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Waits until NodeLink accepts TCP connections or timeout expires.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>}
 */
async function waitForNodelink(host, port) {
  logSupervisor(`Waiting for NodeLink on ${host}:${port}...`);
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (!stopping && Date.now() < deadline) {
    if (await canConnect(host, port)) {
      logSupervisor(`NodeLink is accepting connections on ${host}:${port}.`);
      return;
    }
    await sleep(1000);
  }

  if (!stopping) {
    logSupervisor(`Timed out waiting for NodeLink on ${host}:${port}; starting bot anyway.`);
  }
}

/**
 * Pipes a readable stream line-by-line with an optional prefix.
 * @param {NodeJS.ReadableStream | null} stream
 * @param {string} prefix
 * @param {boolean} isError
 */
function pipeWithPrefix(stream, prefix, isError = false) {
  if (!stream) return;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const output = prefix ? `${prefix} ${line}` : line;
    if (isError) {
      console.error(output);
    } else {
      console.log(output);
    }
  });
}

/**
 * Supervises a single child process with independent exponential backoff restarts.
 * @param {{ name: string, cwd: string, args: string[], logPrefix: string }} spec
 * @returns {Promise<void>}
 */
async function superviseProcess({ name, cwd, args, logPrefix }) {
  let backoffMs = BACKOFF_INITIAL_MS;

  while (!stopping) {
    const startedAt = Date.now();
    logSupervisor(`Starting ${name} (cwd: ${cwd})...`);

    const exitResult = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      });

      activeChildren.add(child);
      pipeWithPrefix(child.stdout, logPrefix, false);
      pipeWithPrefix(child.stderr, logPrefix, true);

      child.once('exit', (code, signal) => {
        activeChildren.delete(child);
        resolve({ code, signal });
      });

      child.once('error', (err) => {
        activeChildren.delete(child);
        logSupervisor(`${name} spawn error: ${err.message}`);
        resolve({ code: 1, signal: null });
      });
    });

    if (stopping) break;

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= STABLE_RESET_MS) {
      backoffMs = BACKOFF_INITIAL_MS;
    }

    logSupervisor(
      `${name} exited (code=${exitResult.code}, signal=${exitResult.signal || 'none'}) after ${Math.round(elapsedMs / 1000)}s. Restarting in ${backoffMs / 1000}s...`
    );

    await sleep(backoffMs);
    backoffMs = Math.min(BACKOFF_MAX_MS, backoffMs * 2);
  }
}

function handleShutdown(signal) {
  if (stopping) return;
  stopping = true;
  logSupervisor(`Received ${signal}. Stopping NodeLink and VanillaSound...`);

  for (const child of activeChildren) {
    try {
      child.kill('SIGTERM');
    } catch {
      // Ignore already-exited child
    }
  }

  setTimeout(() => {
    for (const child of activeChildren) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }
    process.exit(0);
  }, 5_000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

/**
 * Installs runtime npm dependencies if a required package is missing in node_modules.
 * Ensures package.json exists in target dir so npm never walks up to parent workspace.
 * @param {string} name
 * @param {string} dir
 * @param {string[]} markerParts
 */
function ensureDependencies(name, dir, markerParts) {
  const marker = path.join(dir, 'node_modules', ...markerParts);
  if (fs.existsSync(marker)) return;

  const pkgPath = path.join(dir, 'package.json');
  const distPkgPath = path.join(dir, 'dist', 'package.json');
  if (!fs.existsSync(pkgPath) && fs.existsSync(distPkgPath)) {
    logSupervisor(`Restoring ${pkgPath} from ${distPkgPath}...`);
    fs.copyFileSync(distPkgPath, pkgPath);
  }

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing ${pkgPath}; cannot install dependencies for ${name}.`);
  }

  logSupervisor(`${name} dependencies missing in ${dir}. Running npm install --omit=dev...`);
  const result = spawnSync(
    'npm',
    ['install', '--omit=dev', '--no-audit', '--no-fund', '--allow-git=all', '--ignore-scripts'],
    {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, npm_config_allow_git: 'all' }
    }
  );

  if (result.status !== 0) {
    throw new Error(`npm install failed for ${name} (exit code ${result.status ?? 'unknown'})`);
  }

  if (!fs.existsSync(marker)) {
    throw new Error(
      `${name} dependency "${markerParts.join('/')}" is still missing in ${path.join(dir, 'node_modules')} after npm install.`
    );
  }
}

/**
 * Ensures NodeLink base config files exist in nlDir (cwd), restoring from dist/ if needed.
 * @param {string} nlDir
 */
function ensureNodelinkConfig(nlDir) {
  const hasDefault =
    fs.existsSync(path.join(nlDir, 'config.default.ts')) ||
    fs.existsSync(path.join(nlDir, 'config.default.js'));
  const distDefault = path.join(nlDir, 'dist', 'config.default.js');
  if (!hasDefault && fs.existsSync(distDefault)) {
    const targetDefault = path.join(nlDir, 'config.default.js');
    logSupervisor(`Restoring ${targetDefault} from ${distDefault}...`);
    fs.copyFileSync(distDefault, targetDefault);
  }

  const hasUserConfig =
    fs.existsSync(path.join(nlDir, 'config.ts')) ||
    fs.existsSync(path.join(nlDir, 'config.js'));
  const distUserConfig = path.join(nlDir, 'dist', 'config.js');
  if (!hasUserConfig && fs.existsSync(distUserConfig)) {
    const targetUserConfig = path.join(nlDir, 'config.js');
    logSupervisor(`Copying ${distUserConfig} to ${targetUserConfig}...`);
    fs.copyFileSync(distUserConfig, targetUserConfig);
  }
}

async function main() {
  const botDir = resolveBotDir();
  const botEntry = path.join(botDir, 'index.js');
  if (!fs.existsSync(botEntry)) {
    logSupervisor(
      `VanillaSound entrypoint not found (${botEntry}). Upload index.js, src/, and package.json to ${ROOT_DIR}.`
    );
    process.exit(1);
  }

  const nlDir = resolveNodelinkDir(botDir);
  if (!fs.existsSync(nlDir)) {
    logSupervisor(`NodeLink directory not found at ${nlDir}.`);
    process.exit(1);
  }

  ensureDependencies('NodeLink', nlDir, ['@performanc', 'pwsl-server']);
  ensureDependencies('VanillaSound', botDir, ['discord.js']);
  ensureNodelinkConfig(nlDir);

  const nlArgs = resolveNodelinkArgs(nlDir);
  const { host, port } = readNodelinkAddress(botDir);

  const nlPromise = superviseProcess({
    name: 'NodeLink',
    cwd: nlDir,
    args: nlArgs,
    logPrefix: '[VanillaSound/NodeLink]'
  });

  await waitForNodelink(host, port);
  if (stopping) {
    await nlPromise;
    return;
  }

  const botPromise = superviseProcess({
    name: 'VanillaSound',
    cwd: botDir,
    args: ['--max-old-space-size=384', botEntry],
    logPrefix: ''
  });

  await Promise.all([nlPromise, botPromise]);
}

main().catch((err) => {
  logSupervisor(`Fatal launcher error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
