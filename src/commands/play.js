import { ApplicationCommandOptionType } from 'discord.js';
import config, { MAX_QUERY_LENGTH } from '../config.js';
import messages from '../messages.js';
import {
  checkVoicePermissions,
  connectToVoice,
  getAvailableNode,
  getQueue,
  playCurrentTrack
} from '../music/manager.js';
import { buildLoadIdentifier, resolveTracks } from '../music/resolver.js';
import {
  errorEmbed,
  infoEmbed,
  playlistAddedEmbed,
  trackAddedEmbed
} from '../utils/embeds.js';

export const name = 'play';
export const aliases = ['p'];
export const description = 'Play a song or playlist from YouTube, SoundCloud, or Spotify.';

export const slashOptions = [
  {
    type: ApplicationCommandOptionType.String,
    name: 'query',
    description: 'Song name or URL (YouTube, SoundCloud, or Spotify)',
    required: true,
    autocomplete: true
  },
  {
    type: ApplicationCommandOptionType.String,
    name: 'source',
    description: 'Optional search source when entering keywords',
    required: false,
    choices: [
      { name: 'YouTube', value: 'yt' },
      { name: 'SoundCloud', value: 'sc' },
      { name: 'Spotify', value: 'sp' }
    ]
  }
];

/**
 * Resolves and queues a track or playlist, joining the user's voice channel if needed.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  if (!ctx.guild) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.guildOnly)], ephemeral: true });
    return;
  }

  const userChannel = ctx.member?.voice?.channel;
  if (!userChannel) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.needVoiceChannel)], ephemeral: true });
    return;
  }

  const botChannel = ctx.guild.members.me?.voice?.channel;
  if (botChannel && botChannel.id !== userChannel.id) {
    await ctx.reply({
      embeds: [errorEmbed(messages.common.alreadyInOtherChannel(botChannel.name))],
      ephemeral: true
    });
    return;
  }

  const permCheck = checkVoicePermissions(ctx.guild, userChannel);
  if (!permCheck.ok) {
    await ctx.reply({
      embeds: [
        errorEmbed(
          messages.common.missingVoicePermissions(userChannel.name, permCheck.missing.join(', '))
        )
      ],
      ephemeral: true
    });
    return;
  }

  const rawInput = ctx.args.join(' ').trim();
  const parsed = buildLoadIdentifier(rawInput);
  if (parsed.error === 'empty') {
    await ctx.reply({ embeds: [errorEmbed(messages.common.emptyQuery)], ephemeral: true });
    return;
  }
  if (parsed.error === 'too_long') {
    await ctx.reply({
      embeds: [errorEmbed(messages.common.queryTooLong(MAX_QUERY_LENGTH))],
      ephemeral: true
    });
    return;
  }

  const node = getAvailableNode(ctx.client.shoukaku);
  if (!node) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.nodeUnavailable)], ephemeral: true });
    return;
  }

  await ctx.deferReply();

  const result = await resolveTracks(node, parsed.identifier, ctx.user.id);
  if (result.type === 'error') {
    await ctx.reply({ embeds: [errorEmbed(messages.play.loadFailed(result.error))] });
    return;
  }
  if (result.type === 'empty' || result.tracks.length === 0) {
    await ctx.reply({ embeds: [infoEmbed(messages.play.noResults)] });
    return;
  }

  // Re-check node right before connecting in case NodeLink dropped while resolving.
  if (!getAvailableNode(ctx.client.shoukaku)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.nodeUnavailable)] });
    return;
  }

  const existingQueue = getQueue(ctx.guild.id);
  const { queue } = await connectToVoice(
    ctx.client,
    ctx.guild,
    userChannel,
    ctx.channel?.id || existingQueue?.textChannelId || null
  );
  queue.clearTimers();

  if (result.type === 'playlist') {
    const wasIdle = !queue.current;
    if (wasIdle) {
      queue.current = result.tracks[0];
      queue.tracks.push(...result.tracks.slice(1));
      await playCurrentTrack(ctx.client, queue);
    } else {
      queue.tracks.push(...result.tracks);
    }

    await ctx.reply({
      embeds: [
        playlistAddedEmbed(
          result.playlistName || config.brandName,
          result.tracks.length,
          result.skipped,
          result.tracks[0]
        )
      ]
    });
    return;
  }

  const track = result.tracks[0];
  if (!queue.current) {
    queue.current = track;
    await playCurrentTrack(ctx.client, queue);
    await ctx.reply({ embeds: [trackAddedEmbed(track, 0)] });
    return;
  }

  queue.tracks.push(track);
  await ctx.reply({ embeds: [trackAddedEmbed(track, queue.tracks.length)] });
}
