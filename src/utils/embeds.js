import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import messages from '../messages.js';
import {
  createProgressBar,
  formatDuration,
  formatSourceName,
  truncate
} from './format.js';

/**
 * Creates a base embed with the configured brand color and footer.
 * @param {string} [footerText]
 * @returns {EmbedBuilder}
 */
export function createEmbed(footerText = config.brandName) {
  return new EmbedBuilder()
    .setColor(config.brandColor)
    .setFooter({ text: footerText });
}

/**
 * Creates an informational embed.
 * @param {string} description
 * @param {string} [title]
 * @returns {EmbedBuilder}
 */
export function infoEmbed(description, title = messages.common.infoTitle) {
  return createEmbed().setTitle(title).setDescription(description);
}

/**
 * Creates a user-facing error embed.
 * @param {string} description
 * @returns {EmbedBuilder}
 */
export function errorEmbed(description) {
  return createEmbed()
    .setTitle(messages.common.errorTitle)
    .setDescription(description);
}

/**
 * Builds the embed shown when a single track is added or starts playing.
 * @param {object} track
 * @param {number} position 0 if playing immediately, otherwise 1-based queue position
 * @returns {EmbedBuilder}
 */
export function trackAddedEmbed(track, position) {
  const titleText = truncate(track.title, 256);
  const embed = createEmbed()
    .setTitle(messages.play.embedTrackTitle)
    .setDescription(track.uri ? `[${titleText}](${track.uri})` : titleText)
    .addFields(
      { name: messages.play.fieldArtist, value: truncate(track.author || messages.common.requesterUnknown, 100), inline: true },
      { name: messages.play.fieldDuration, value: formatDuration(track.length, track.isStream), inline: true },
      { name: messages.play.fieldSource, value: formatSourceName(track.sourceName), inline: true },
      {
        name: messages.play.fieldPosition,
        value: position === 0 ? messages.play.playingNow : `#${position}`,
        inline: true
      }
    );

  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  }

  return embed;
}

/**
 * Builds the embed shown when a playlist or album is queued.
 * @param {string} name
 * @param {number} added
 * @param {number} skipped
 * @param {object | null} firstTrack
 * @returns {EmbedBuilder}
 */
export function playlistAddedEmbed(name, added, skipped, firstTrack) {
  const embed = createEmbed()
    .setTitle(messages.play.embedPlaylistTitle)
    .setDescription(messages.play.playlistQueued(truncate(name, 120), added, skipped))
    .addFields(
      { name: messages.play.fieldTracksAdded, value: String(added), inline: true },
      { name: messages.play.fieldSource, value: formatSourceName(firstTrack?.sourceName), inline: true }
    );

  if (skipped > 0) {
    embed.addFields({
      name: messages.play.fieldTracksSkipped,
      value: String(skipped),
      inline: true
    });
  }

  if (firstTrack?.artworkUrl) {
    embed.setThumbnail(firstTrack.artworkUrl);
  }

  return embed;
}

/**
 * Builds the Now Playing embed.
 * @param {import('../music/queue.js').Queue} queue
 * @param {string} [title]
 * @returns {EmbedBuilder}
 */
export function nowPlayingEmbed(queue, title = messages.nowPlaying.title) {
  const track = queue.current;
  const elapsed = queue.player ? Math.max(0, queue.player.position || 0) : 0;
  const durationText = track.isStream
    ? messages.common.liveLabel
    : `${formatDuration(elapsed)} / ${formatDuration(track.length)}`;
  const bar = createProgressBar(elapsed, track.isStream ? 0 : track.length);

  const trackTitle = truncate(track.title, 256);
  const loopLabel = messages.loopModes[queue.loopMode] || messages.loopModes.off;
  const stayLabel = queue.stay247
    ? messages.nowPlaying.stay247On
    : messages.nowPlaying.stay247Off;

  const requesterValue = track.requesterId
    ? `<@${track.requesterId}>`
    : messages.common.requesterUnknown;

  const embed = createEmbed()
    .setTitle(title)
    .setDescription(track.uri ? `[${trackTitle}](${track.uri})` : trackTitle)
    .addFields(
      { name: messages.nowPlaying.fieldAuthor, value: truncate(track.author || messages.common.requesterUnknown, 100), inline: true },
      { name: messages.nowPlaying.fieldSource, value: formatSourceName(track.sourceName), inline: true },
      { name: messages.nowPlaying.fieldRequester, value: requesterValue, inline: true },
      { name: messages.nowPlaying.fieldProgress, value: `\`${bar}\` ${durationText}`, inline: false },
      { name: messages.nowPlaying.fieldLoop, value: loopLabel, inline: true },
      { name: messages.nowPlaying.fieldStay247, value: stayLabel, inline: true }
    );

  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  }

  return embed;
}

/**
 * Builds a paginated queue embed.
 * @param {import('../music/queue.js').Queue} queue
 * @param {number} page 1-based page number
 * @param {number} totalPages
 * @param {Array<object>} pageTracks
 * @param {number} startIndex 0-based index in upcoming tracks
 * @returns {EmbedBuilder}
 */
export function queueEmbed(queue, page, totalPages, pageTracks, startIndex) {
  const current = queue.current;
  const lines = [];

  if (current) {
    const dur = formatDuration(current.length, current.isStream);
    lines.push(`**${messages.queue.nowPlayingHeader}**`);
    lines.push(`${truncate(current.title, 70)} [${dur}]`);
    lines.push('');
  }

  lines.push(`**${messages.queue.upcomingHeader}**`);
  if (pageTracks.length === 0) {
    lines.push(messages.queue.noUpcoming);
  } else {
    for (let i = 0; i < pageTracks.length; i += 1) {
      const t = pageTracks[i];
      const num = startIndex + i + 1;
      const dur = formatDuration(t.length, t.isStream);
      lines.push(`${num}. ${truncate(t.title, 65)} [${dur}]`);
    }
  }

  const totalRemainingMs = queue.getTotalRemainingDuration();
  const summary = messages.queue.footerSummary(
    page,
    totalPages,
    queue.tracks.length,
    formatDuration(totalRemainingMs)
  );

  return createEmbed(`${config.brandName} | ${summary}`)
    .setTitle(messages.queue.title)
    .setDescription(lines.join('\n'));
}

/**
 * Builds the 24/7 mode status embed.
 * @param {boolean} enabled
 * @param {string | null} voiceChannelId
 * @param {boolean} connected
 * @returns {EmbedBuilder}
 */
export function status247Embed(enabled, voiceChannelId, connected) {
  return createEmbed()
    .setTitle(messages.stay247.statusTitle)
    .addFields(
      {
        name: messages.stay247.statusState,
        value: enabled ? messages.stay247.statusOn : messages.stay247.statusOff,
        inline: true
      },
      {
        name: messages.stay247.statusChannel,
        value: voiceChannelId ? `<#${voiceChannelId}>` : messages.common.none,
        inline: true
      },
      {
        name: messages.stay247.statusConnected,
        value: connected ? messages.stay247.yes : messages.stay247.no,
        inline: true
      }
    );
}
