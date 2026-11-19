import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import messages from '../messages.js';
import { infoEmbed } from '../utils/embeds.js';
import {
  attachPlayerListeners,
  checkVoicePermissions,
  connectToVoice,
  getAvailableNode,
  getOrCreateQueue,
  getQueue,
  playCurrentTrack,
  setStay247Lookup
} from './manager.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, '247.json');
const BACKUP_PATH = path.join(DATA_DIR, '247.json.bak');
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const REJOIN_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
const STARTUP_REJOIN_DELAY_MS = 1_000;

/**
 * In-memory 24/7 store keyed by guildId:
 * { "<guildId>": { voiceChannelId: string, textChannelId: string } }
 * @type {Map<string, { voiceChannelId: string, textChannelId: string }>}
 */
const store = new Map();

/**
 * Serializes atomic writes so concurrent commands cannot corrupt data/247.json.
 * @type {Promise<void>}
 */
let writeQueue = Promise.resolve();

let discordReady = false;
let nodeReady = false;
let initialRestoreStarted = false;
let nodeHadDisconnected = false;
let healthCheckTimer = null;

/**
 * Tracks guilds currently running a rejoin backoff loop to avoid overlaps.
 * @type {Set<string>}
 */
const activeRejoins = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensures the data directory and 247.json file exist, then loads entries into memory.
 * If the JSON file is corrupt, backs it up to 247.json.bak and starts empty.
 * @returns {Promise<void>}
 */
export async function load247Store() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  store.clear();

  let raw;
  try {
    raw = await fs.readFile(STORE_PATH, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await save247Store();
      return;
    }
    throw error;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    await save247Store();
    return;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Top-level JSON value must be an object');
    }

    for (const [guildId, entry] of Object.entries(parsed)) {
      if (
        entry &&
        typeof entry.voiceChannelId === 'string' &&
        typeof entry.textChannelId === 'string'
      ) {
        store.set(guildId, {
          voiceChannelId: entry.voiceChannelId,
          textChannelId: entry.textChannelId
        });
      }
    }
  } catch (error) {
    console.warn(
      `[${config.brandName}] Corrupt 24/7 state file detected (${error instanceof Error ? error.message : String(error)}). Backing up to 247.json.bak and starting empty.`
    );
    await fs.copyFile(STORE_PATH, BACKUP_PATH).catch(() => {});
    store.clear();
    await save247Store();
  }
}

/**
 * Atomically persists the current 24/7 store to data/247.json using temp file + rename.
 * @returns {Promise<void>}
 */
export function save247Store() {
  const snapshot = {};
  for (const [guildId, entry] of store.entries()) {
    snapshot[guildId] = {
      voiceChannelId: entry.voiceChannelId,
      textChannelId: entry.textChannelId
    };
  }

  const payload = JSON.stringify(snapshot, null, 2);
  const tmpPath = path.join(DATA_DIR, `247.json.tmp.${process.pid}.${Date.now()}`);

  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(tmpPath, payload, 'utf8');
      await fs.rename(tmpPath, STORE_PATH);
    })
    .catch((error) => {
      console.error(
        `[${config.brandName}] Failed to write 24/7 state file:`,
        error instanceof Error ? error.message : String(error)
      );
      return fs.unlink(tmpPath).catch(() => {});
    });

  return writeQueue;
}

/**
 * Returns the saved 24/7 entry for a guild, or null if not enabled.
 * @param {string} guildId
 * @returns {{ voiceChannelId: string, textChannelId: string } | null}
 */
export function get247Entry(guildId) {
  return store.get(guildId) || null;
}

/**
 * Checks whether 24/7 mode is enabled for a guild.
 * @param {string} guildId
 * @returns {boolean}
 */
export function is247Enabled(guildId) {
  return store.has(guildId);
}

/**
 * Enables or updates 24/7 mode for a guild and persists immediately.
 * @param {string} guildId
 * @param {string} voiceChannelId
 * @param {string} textChannelId
 * @returns {Promise<void>}
 */
export async function set247Entry(guildId, voiceChannelId, textChannelId) {
  store.set(guildId, { voiceChannelId, textChannelId });
  const queue = getQueue(guildId);
  if (queue) {
    queue.stay247 = true;
    queue.clearTimers();
  }
  await save247Store();
}

/**
 * Disables 24/7 mode for a guild and persists immediately.
 * @param {string} guildId
 * @returns {Promise<boolean>} true if an entry existed and was removed
 */
export async function remove247Entry(guildId) {
  const existed = store.delete(guildId);
  const queue = getQueue(guildId);
  if (queue) {
    queue.stay247 = false;
  }
  if (existed) {
    await save247Store();
  }
  return existed;
}

// Register lookup helper with queue manager
setStay247Lookup(get247Entry);

/**
 * Notifies a guild's saved text channel if accessible.
 * @param {import('discord.js').Client} client
 * @param {string} textChannelId
 * @param {string} messageText
 * @returns {Promise<void>}
 */
async function notifyTextChannel(client, textChannelId, messageText) {
  if (!textChannelId) return;
  try {
    const channel =
      client.channels.cache.get(textChannelId) ||
      (await client.channels.fetch(textChannelId).catch(() => null));
    if (channel && channel.isTextBased() && !channel.isDMBased()) {
      await channel.send({ embeds: [infoEmbed(messageText)] }).catch(() => {});
    }
  } catch {
    // Channel may no longer exist
  }
}

/**
 * Validates and rejoins a single 24/7 guild. Removes the entry if guild/channel/permissions are invalid.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {{ voiceChannelId: string, textChannelId: string }} entry
 * @returns {Promise<'connected' | 'removed' | 'failed'>}
 */
async function tryRejoinGuild(client, guildId, entry) {
  const guild =
    client.guilds.cache.get(guildId) ||
    (await client.guilds.fetch(guildId).catch(() => null));

  if (!guild) {
    console.warn(`[${config.brandName}] 24/7 guild ${guildId} no longer exists. Removing entry.`);
    await remove247Entry(guildId);
    return 'removed';
  }

  const voiceChannel =
    guild.channels.cache.get(entry.voiceChannelId) ||
    (await guild.channels.fetch(entry.voiceChannelId).catch(() => null));

  if (!voiceChannel || !voiceChannel.isVoiceBased()) {
    console.warn(
      `[${config.brandName}] 24/7 voice channel ${entry.voiceChannelId} missing in guild ${guildId}. Removing entry.`
    );
    await remove247Entry(guildId);
    await notifyTextChannel(client, entry.textChannelId, messages.stay247.missingChannelRemoved);
    return 'removed';
  }

  const permCheck = checkVoicePermissions(guild, voiceChannel);
  if (!permCheck.ok) {
    console.warn(
      `[${config.brandName}] Missing ${permCheck.missing.join(', ')} permission in 24/7 channel ${entry.voiceChannelId} (guild ${guildId}). Removing entry.`
    );
    await remove247Entry(guildId);
    await notifyTextChannel(client, entry.textChannelId, messages.stay247.missingChannelRemoved);
    return 'removed';
  }

  if (!getAvailableNode(client.shoukaku)) {
    return 'failed';
  }

  try {
    const queue = getOrCreateQueue(guildId, entry.textChannelId, true);
    queue.stay247 = true;
    queue.clearTimers();

    const { player } = await connectToVoice(client, guild, voiceChannel, entry.textChannelId);
    attachPlayerListeners(client, queue, player);

    // If a track was already active in memory (e.g. after NodeLink reconnect), resume it.
    if (queue.current) {
      await playCurrentTrack(client, queue, player.position || 0);
    }

    return 'connected';
  } catch (error) {
    console.warn(
      `[${config.brandName}] Failed to rejoin 24/7 channel in guild ${guildId}: ${error instanceof Error ? error.message : String(error)}`
    );
    return 'failed';
  }
}

/**
 * Rejoins a single 24/7 guild using exponential backoff (5s, 10s, 20s, 40s, 60s).
 * Stops after 5 consecutive failures and waits for the next 60s health check cycle.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {Promise<void>}
 */
export async function rejoinWithBackoff(client, guildId) {
  if (activeRejoins.has(guildId)) return;
  const entry = get247Entry(guildId);
  if (!entry) return;

  activeRejoins.add(guildId);
  try {
    for (let attempt = 0; attempt < REJOIN_BACKOFF_MS.length; attempt += 1) {
      const currentEntry = get247Entry(guildId);
      if (!currentEntry) return;

      const delayMs = REJOIN_BACKOFF_MS[attempt];
      console.log(
        `[${config.brandName}] 24/7 rejoin attempt ${attempt + 1}/${REJOIN_BACKOFF_MS.length} for guild ${guildId} in ${delayMs / 1000}s.`
      );
      await sleep(delayMs);

      if (!get247Entry(guildId)) return;
      const result = await tryRejoinGuild(client, guildId, currentEntry);
      if (result === 'connected' || result === 'removed') {
        if (result === 'connected') {
          console.log(`[${config.brandName}] 24/7 rejoin succeeded for guild ${guildId}.`);
        }
        return;
      }
    }

    console.warn(
      `[${config.brandName}] 24/7 rejoin paused for guild ${guildId} after 5 attempts; will retry on next health check.`
    );
  } finally {
    activeRejoins.delete(guildId);
  }
}

/**
 * Restores all saved 24/7 voice connections sequentially with a 1s gap.
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function restoreAll247Guilds(client) {
  const entries = [...store.entries()];
  if (entries.length === 0) return;

  console.log(`[${config.brandName}] Restoring ${entries.length} 24/7 voice connection(s).`);

  for (let i = 0; i < entries.length; i += 1) {
    const [guildId, entry] = entries[i];
    const outcome = await tryRejoinGuild(client, guildId, entry);
    if (outcome === 'connected') {
      console.log(`[${config.brandName}] Restored 24/7 connection for guild ${guildId}.`);
    } else if (outcome === 'failed') {
      void rejoinWithBackoff(client, guildId);
    }

    if (i < entries.length - 1) {
      await sleep(STARTUP_REJOIN_DELAY_MS);
    }
  }
}

/**
 * Periodic 60-second health check verifying every 24/7 guild is connected and has a player.
 * @param {import('discord.js').Client} client
 */
function startHealthCheckLoop(client) {
  if (healthCheckTimer) return;

  healthCheckTimer = setInterval(async () => {
    if (!discordReady || !getAvailableNode(client.shoukaku)) return;

    for (const [guildId, entry] of store.entries()) {
      if (activeRejoins.has(guildId)) continue;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        await tryRejoinGuild(client, guildId, entry);
        continue;
      }

      const botChannelId = guild.members.me?.voice?.channelId || null;
      const shoukakuPlayer = client.shoukaku.players.get(guildId);
      const queue = getQueue(guildId);

      const healthy =
        botChannelId === entry.voiceChannelId &&
        Boolean(shoukakuPlayer) &&
        Boolean(queue?.player);

      if (!healthy) {
        console.warn(
          `[${config.brandName}] 24/7 health check detected missing connection or player in guild ${guildId}.`
        );
        void rejoinWithBackoff(client, guildId);
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Stops the 24/7 health check interval during graceful shutdown.
 */
export function stop247HealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

/**
 * Marks Discord client as ready and triggers 24/7 restore if NodeLink is also connected.
 * @param {import('discord.js').Client} client
 */
export function onDiscordReady(client) {
  discordReady = true;
  if (nodeReady && !initialRestoreStarted) {
    initialRestoreStarted = true;
    startHealthCheckLoop(client);
    void restoreAll247Guilds(client);
  }
}

/**
 * Marks NodeLink node as ready, triggering initial 24/7 restore or post-drop recovery.
 * @param {import('discord.js').Client} client
 */
export function onNodeReady(client) {
  nodeReady = true;

  if (discordReady && !initialRestoreStarted) {
    initialRestoreStarted = true;
    startHealthCheckLoop(client);
    void restoreAll247Guilds(client);
    return;
  }

  if (discordReady && nodeHadDisconnected) {
    nodeHadDisconnected = false;
    console.log(`[${config.brandName}] NodeLink reconnected. Re-establishing 24/7 players.`);
    void restoreAll247Guilds(client);
  }
}

/**
 * Records that NodeLink dropped so subsequent ready events trigger player recovery.
 */
export function onNodeDrop() {
  nodeHadDisconnected = true;
}
