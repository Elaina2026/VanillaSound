import 'dotenv/config';

/**
 * Brand name used consistently across logs, embeds, and presence.
 */
export const BRAND_NAME = 'VanillaSound';

/**
 * Maximum number of tracks imported from a single playlist or album request.
 */
export const MAX_PLAYLIST_TRACKS = 50;

/**
 * Maximum length allowed for URLs or search queries.
 */
export const MAX_QUERY_LENGTH = 500;

/**
 * Parses a boolean-like environment variable.
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseBoolean(value, fallback) {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

/**
 * Parses an integer environment variable within inclusive bounds.
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function parseInteger(value, fallback, min, max) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Parses a hex color string into a 24-bit integer for Discord embeds.
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function parseHexColor(value, fallback) {
  if (!value || value.trim() === '') return fallback;
  const cleaned = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return fallback;
  return Number.parseInt(cleaned, 16);
}

/**
 * Loads and validates configuration from environment variables.
 * Exits immediately with a clear message if required secrets are missing.
 * @returns {Readonly<object>}
 */
function loadConfig() {
  const token = process.env.TOKEN?.trim();
  const nodelinkPassword = process.env.NODELINK_PASSWORD?.trim();

  const missing = [];
  if (!token) missing.push('TOKEN');
  if (!nodelinkPassword) missing.push('NODELINK_PASSWORD');

  if (missing.length > 0) {
    console.error(
      `[${BRAND_NAME}] Missing required environment variable(s): ${missing.join(', ')}. Copy .env.example to .env and fill them in.`
    );
    process.exit(1);
  }

  const clientId = process.env.CLIENT_ID?.trim() || '';
  if (!clientId) {
    console.warn(
      `[${BRAND_NAME}] CLIENT_ID is not set. Slash commands will be registered after login using client.application.id.`
    );
  }

  const rawNodelinkUrl = process.env.NODELINK_URL?.trim() || '127.0.0.1:2333';
  // Shoukaku expects host:port without a protocol scheme.
  const nodelinkUrl = rawNodelinkUrl.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '').replace(/\/+$/, '');

  return Object.freeze({
    brandName: BRAND_NAME,
    brandColor: parseHexColor(process.env.BRAND_COLOR, 0x5865f2),
    token,
    clientId,
    guildId: process.env.GUILD_ID?.trim() || '',
    prefix: process.env.PREFIX?.trim() || '!',
    ownerId: process.env.OWNER_ID?.trim() || '',
    nodelinkUrl,
    nodelinkPassword,
    nodelinkSecure: parseBoolean(process.env.NODELINK_SECURE, false),
    defaultVolume: parseInteger(process.env.DEFAULT_VOLUME, 50, 0, 100),
    idleLeaveSeconds: parseInteger(process.env.IDLE_LEAVE_SECONDS, 120, 10, 86400),
    fallbackPlaylistUrl: process.env.FALLBACK_PLAYLIST_URL?.trim() || ''
  });
}

export const config = loadConfig();
export default config;
