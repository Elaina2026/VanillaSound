import { MAX_PLAYLIST_TRACKS, MAX_QUERY_LENGTH } from '../config.js';
import { formatSourceName, truncate } from '../utils/format.js';

const SOURCE_PREFIXES = {
  yt: 'ytsearch',
  sc: 'scsearch',
  sp: 'spsearch'
};

let trackInstanceCounter = 0;

/**
 * Generates a unique per-enqueue instance ID so repeated tracks still get announced once per play.
 * @returns {string}
 */
function nextInstanceId() {
  trackInstanceCounter = (trackInstanceCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now()}-${trackInstanceCounter}`;
}

/**
 * Converts a raw NodeLink/Lavalink track object into a compact, memory-safe structure.
 * @param {object} rawTrack
 * @param {string | null} requesterId
 * @returns {object}
 */
export function compactTrack(rawTrack, requesterId = null) {
  const info = rawTrack?.info || {};
  return {
    instanceId: nextInstanceId(),
    encoded: rawTrack.encoded,
    title: info.title || 'Unknown Title',
    author: info.author || 'Unknown Artist',
    uri: info.uri || null,
    length: Number.isFinite(info.length) ? info.length : 0,
    artworkUrl: info.artworkUrl || null,
    sourceName: info.sourceName || 'unknown',
    isStream: Boolean(info.isStream),
    isSeekable: info.isSeekable !== false,
    requesterId
  };
}

/**
 * Detects whether the input is a supported HTTP/HTTPS URL from YouTube, SoundCloud, or Spotify.
 * @param {string} input
 * @returns {boolean}
 */
export function isSupportedUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return (
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtu.be' ||
    host === 'soundcloud.com' ||
    host === 'www.soundcloud.com' ||
    host === 'm.soundcloud.com' ||
    host === 'on.soundcloud.com' ||
    host === 'open.spotify.com' ||
    host === 'spotify.link' ||
    host === 'spotify.app.link'
  );
}

/**
 * Parses raw user play input (optional source switch + query or URL) into a NodeLink identifier.
 * @param {string} rawInput
 * @returns {{ identifier: string, isUrl: boolean, error?: string }}
 */
export function buildLoadIdentifier(rawInput) {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return { identifier: '', isUrl: false, error: 'empty' };
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { identifier: '', isUrl: false, error: 'too_long' };
  }

  if (isSupportedUrl(trimmed)) {
    return { identifier: trimmed, isUrl: true };
  }

  // Check optional source switch: "yt <query>", "sc <query>", "sp <query>"
  const parts = trimmed.split(/\s+/);
  const firstToken = parts[0].toLowerCase();
  if (SOURCE_PREFIXES[firstToken] && parts.length > 1) {
    const query = parts.slice(1).join(' ').trim();
    if (isSupportedUrl(query)) {
      return { identifier: query, isUrl: true };
    }
    return {
      identifier: `${SOURCE_PREFIXES[firstToken]}:${query}`,
      isUrl: false
    };
  }

  return {
    identifier: `${SOURCE_PREFIXES.yt}:${trimmed}`,
    isUrl: false
  };
}

/**
 * Resolves a query or URL through NodeLink and normalizes the response.
 * Caps playlists and albums at MAX_PLAYLIST_TRACKS (50) to protect RAM.
 * @param {import('shoukaku').Node} node
 * @param {string} identifier
 * @param {string | null} requesterId
 * @param {number} [maxTracks=MAX_PLAYLIST_TRACKS]
 * @returns {Promise<{ type: 'track' | 'playlist' | 'empty' | 'error', tracks: object[], playlistName: string | null, skipped: number, error?: string }>}
 */
export async function resolveTracks(node, identifier, requesterId, maxTracks = MAX_PLAYLIST_TRACKS) {
  const response = await node.rest.resolve(identifier);
  if (!response) {
    return { type: 'empty', tracks: [], playlistName: null, skipped: 0 };
  }

  switch (response.loadType) {
    case 'track': {
      if (!response.data) {
        return { type: 'empty', tracks: [], playlistName: null, skipped: 0 };
      }
      return {
        type: 'track',
        tracks: [compactTrack(response.data, requesterId)],
        playlistName: null,
        skipped: 0
      };
    }

    case 'search': {
      const first = Array.isArray(response.data) ? response.data[0] : null;
      if (!first) {
        return { type: 'empty', tracks: [], playlistName: null, skipped: 0 };
      }
      return {
        type: 'track',
        tracks: [compactTrack(first, requesterId)],
        playlistName: null,
        skipped: 0
      };
    }

    case 'playlist': {
      const rawTracks = Array.isArray(response.data?.tracks) ? response.data.tracks : [];
      if (rawTracks.length === 0) {
        return { type: 'empty', tracks: [], playlistName: null, skipped: 0 };
      }
      const capped = rawTracks.slice(0, maxTracks);
      const skipped = Math.max(0, rawTracks.length - capped.length);
      return {
        type: 'playlist',
        tracks: capped.map((t) => compactTrack(t, requesterId)),
        playlistName: response.data?.info?.name || 'Playlist',
        skipped
      };
    }

    case 'error': {
      return {
        type: 'error',
        tracks: [],
        playlistName: null,
        skipped: 0,
        error: response.data?.message || 'Audio server rejected the request'
      };
    }

    case 'empty':
    default:
      return { type: 'empty', tracks: [], playlistName: null, skipped: 0 };
  }
}

/**
 * Fetches up to 5 autocomplete suggestions for the slash play command within 2.5s.
 * Fails silently with an empty array on any error or timeout.
 * @param {import('shoukaku').Shoukaku} shoukaku
 * @param {string} rawQuery
 * @returns {Promise<Array<{ name: string, value: string }>>}
 */
export async function searchAutocomplete(shoukaku, rawQuery) {
  const query = (rawQuery || '').trim();
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return [];
  }

  // If user already pasted a direct URL, avoid unnecessary search requests.
  if (isSupportedUrl(query)) {
    return [
      {
        name: truncate(query, 100),
        value: query.slice(0, 100)
      }
    ];
  }

  let timeoutHandle;
  try {
    if (!shoukaku?.options?.nodeResolver) return [];
    const node = shoukaku.options.nodeResolver(shoukaku.nodes);
    if (!node) return [];

    const { identifier } = buildLoadIdentifier(query);
    if (!identifier) return [];

    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve(null), 2400);
    });

    const response = await Promise.race([
      node.rest.resolve(identifier),
      timeoutPromise
    ]);

    if (!response) return [];

    let rawTracks = [];
    if (response.loadType === 'search' && Array.isArray(response.data)) {
      rawTracks = response.data.slice(0, 5);
    } else if (response.loadType === 'track' && response.data) {
      rawTracks = [response.data];
    } else if (response.loadType === 'playlist' && Array.isArray(response.data?.tracks)) {
      rawTracks = response.data.tracks.slice(0, 5);
    }

    return rawTracks
      .filter((t) => t?.info?.title)
      .slice(0, 5)
      .map((t) => {
        const title = t.info.title;
        const author = t.info.author || formatSourceName(t.info.sourceName);
        const displayName = truncate(`${title} - ${author}`, 100);
        const candidateValue =
          t.info.uri && t.info.uri.length <= 100
            ? t.info.uri
            : truncate(`${title} ${author}`, 100);
        return {
          name: displayName,
          value: candidateValue
        };
      });
  } catch {
    return [];
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
