import { ApplicationCommandOptionType } from 'discord.js';
import messages from '../messages.js';
import { getAvailableNode } from '../music/manager.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { formatDuration, parseTimestamp } from '../utils/format.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';

export const name = 'seek';
export const aliases = [];
export const description = 'Seek to a timestamp in the current track (mm:ss or seconds).';

export const slashOptions = [
  {
    type: ApplicationCommandOptionType.String,
    name: 'timestamp',
    description: 'Target time such as 1:30 or 90',
    required: true
  }
];

/**
 * Seeks the active player to a specified timestamp.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  const check = await requireSameVoiceChannel(ctx, { requireCurrentTrack: true });
  if (!check.ok) return;

  const { queue } = check;
  const track = queue.current;
  if (!track.isSeekable || track.isStream) {
    await ctx.reply({ embeds: [errorEmbed(messages.seek.notSeekable)], ephemeral: true });
    return;
  }

  const targetMs = parseTimestamp(ctx.args[0] || '');
  if (targetMs === null) {
    await ctx.reply({ embeds: [errorEmbed(messages.seek.invalidTimestamp)], ephemeral: true });
    return;
  }

  if (track.length > 0 && targetMs > track.length) {
    await ctx.reply({
      embeds: [errorEmbed(messages.seek.outOfRange(formatDuration(track.length)))],
      ephemeral: true
    });
    return;
  }

  if (!getAvailableNode(ctx.client.shoukaku)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.nodeUnavailable)], ephemeral: true });
    return;
  }

  await queue.player.seekTo(targetMs);
  await ctx.reply({ embeds: [infoEmbed(messages.seek.seeked(formatDuration(targetMs)))] });
}
