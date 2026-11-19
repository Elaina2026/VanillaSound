import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Options } from 'discord.js';
import { Connectors, Shoukaku } from 'shoukaku';
import config from './src/config.js';
import { registerShoukakuEvents, clearShoukakuTimers } from './src/events/shoukaku.js';
import { shutdownAllPlayers } from './src/music/manager.js';
import { load247Store, stop247HealthCheck } from './src/music/stay247.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let startupFinished = false;
let isShuttingDown = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    PresenceManager: 0,
    GuildEmojiManager: 0,
    GuildStickerManager: 0,
    GuildScheduledEventManager: 0,
    GuildInviteManager: 0,
    GuildBanManager: 0,
    StageInstanceManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    AutoModerationRuleManager: 0,
    UserManager: {
      maxSize: 100,
      keepOverLimit: (user) => user.id === user.client.user?.id
    },
    GuildMemberManager: {
      maxSize: 150,
      keepOverLimit: (member) =>
        member.id === member.client.user?.id || Boolean(member.voice?.channelId)
    }
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    users: {
      interval: 1800,
      filter: () => (user) => user.id !== user.client.user?.id
    }
  }
});

client.commands = new Collection();
client.aliases = new Map();

const shoukakuNodes = [
  {
    name: 'nodelink-local',
    url: config.nodelinkUrl,
    auth: config.nodelinkPassword,
    secure: config.nodelinkSecure
  }
];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), shoukakuNodes, {
  moveOnDisconnect: false,
  resume: true,
  resumeTimeout: 30,
  reconnectTries: 20,
  reconnectInterval: 5,
  restTimeout: 60
});

client.shoukaku = shoukaku;
registerShoukakuEvents(client, shoukaku);

/**
 * Loads all command modules from src/commands into client.commands and client.aliases.
 * @returns {Promise<void>}
 */
async function loadCommands() {
  const commandsDir = path.join(__dirname, 'src', 'commands');
  const files = (await fs.readdir(commandsDir)).filter((f) => f.endsWith('.js')).sort();

  for (const file of files) {
    const fileUrl = pathToFileURL(path.join(commandsDir, file)).href;
    const mod = await import(fileUrl);
    if (!mod?.name || typeof mod.execute !== 'function') continue;

    client.commands.set(mod.name, mod);
    for (const alias of mod.aliases || []) {
      client.aliases.set(alias.toLowerCase(), mod.name);
    }
  }

  console.log(`[${config.brandName}] Loaded ${client.commands.size} command(s).`);
}

/**
 * Loads Discord client event modules from src/events (excluding shoukaku.js).
 * @returns {Promise<void>}
 */
async function loadEvents() {
  const eventsDir = path.join(__dirname, 'src', 'events');
  const files = (await fs.readdir(eventsDir))
    .filter((f) => f.endsWith('.js') && f !== 'shoukaku.js')
    .sort();

  for (const file of files) {
    const fileUrl = pathToFileURL(path.join(eventsDir, file)).href;
    const mod = await import(fileUrl);
    if (!mod?.name || typeof mod.execute !== 'function') continue;

    if (mod.once) {
      client.once(mod.name, (...args) => void mod.execute(...args));
    } else {
      client.on(mod.name, (...args) => void mod.execute(...args));
    }
  }
}

/**
 * Gracefully tears down active players, voice connections, and the Discord client.
 * Preserves data/247.json across restarts.
 * @param {string} signal
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[${config.brandName}] Received ${signal}. Shutting down gracefully...`);
  stop247HealthCheck();
  clearShoukakuTimers();

  try {
    await shutdownAllPlayers(client);
  } catch (error) {
    console.error(
      `[${config.brandName}] Error destroying players during shutdown:`,
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    await client.destroy();
  } catch {
    // Ignore destroy errors during exit
  }

  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error(`[${config.brandName}] Unhandled rejection:`, detail);
  if (!startupFinished) {
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error(
    `[${config.brandName}] Uncaught exception:`,
    error instanceof Error ? error.stack || error.message : String(error)
  );
  if (!startupFinished) {
    process.exit(1);
  }
});

async function bootstrap() {
  await load247Store();
  await loadCommands();
  await loadEvents();
  await client.login(config.token);
  startupFinished = true;
}

bootstrap().catch((error) => {
  console.error(
    `[${config.brandName}] Fatal startup error:`,
    error instanceof Error ? error.stack || error.message : String(error)
  );
  process.exit(1);
});
