import { messages } from '../messages.js';

/**
 * Formats a millisecond duration as MM:SS or HH:MM:SS.
 * Returns the live label for non-positive or stream durations when marked live.
 * @param {number} ms
 * @param {boolean} [isStream=false]
 * @returns {string}
 */
export function formatDuration(ms, isStream = false) {
  if (isStream || !Number.isFinite(ms) || ms <= 0) {
    return isStream ? messages.common.liveLabel : '0:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/**
 * Parses a timestamp string (`ss`, `mm:ss`, or `hh:mm:ss`) into milliseconds.
 * Returns null if the input is invalid.
 * @param {string} input
 * @returns {number | null}
 */
export function parseTimestamp(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const numbers = parts.map((p) => {
    if (!/^\d+$/.test(p)) return Number.NaN;
    return Number.parseInt(p, 10);
  });

  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;

  if (numbers.length === 2) {
    const [minutes, seconds] = numbers;
    if (seconds >= 60) return null;
    return (minutes * 60 + seconds) * 1000;
  }

  const [hours, minutes, seconds] = numbers;
  if (minutes >= 60 || seconds >= 60) return null;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Builds an ASCII progress bar without emojis.
 * @param {number} currentMs
 * @param {number} totalMs
 * @param {number} [width=16]
 * @returns {string}
 */
export function createProgressBar(currentMs, totalMs, width = 16) {
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return `[${'='.repeat(width)}]`;
  }

  const ratio = Math.min(1, Math.max(0, currentMs / totalMs));
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  const pointer = filled < width ? '>' : '';
  const emptyCount = Math.max(0, width - filled - (pointer ? 1 : 0));

  return `[${'='.repeat(filled)}${pointer}${'-'.repeat(emptyCount)}]`;
}

/**
 * Truncates text to maxLength with an ellipsis if needed.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Maps a NodeLink sourceName to a human-friendly display name.
 * @param {string | undefined} sourceName
 * @returns {string}
 */
export function formatSourceName(sourceName) {
  const key = (sourceName || '').toLowerCase();
  if (key === 'youtube') return messages.sources.youtube;
  if (key === 'ytmusic') return messages.sources.ytmusic;
  if (key === 'soundcloud') return messages.sources.soundcloud;
  if (key === 'spotify') return messages.sources.spotify;
  return sourceName || messages.common.unknownSource;
}
