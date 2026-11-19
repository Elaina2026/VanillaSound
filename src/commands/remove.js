import { ApplicationCommandOptionType } from 'discord.js';
import messages from '../messages.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';

export const name = 'remove';
export const aliases = ['rm'];
export const description = 'Remove a track from the upcoming queue by its position.';

export const slashOptions = [
  {
    type: ApplicationCommandOptionType.Integer,
    name: 'position',
    description: '1-based position in the upcoming queue',
    required: true,
    minValue: 1
  }
];

/**
 * Removes an upcoming track at the requested 1-based position.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  const check = await requireSameVoiceChannel(ctx, { requireCurrentTrack: false });
  if (!check.ok) return;

  const { queue } = check;
  if (!queue) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return;
  }

  if (queue.tracks.length === 0) {
    await ctx.reply({ embeds: [errorEmbed(messages.remove.emptyQueue)], ephemeral: true });
    return;
  }

  const rawPos = ctx.args[0]?.trim() || '';
  if (!/^\d+$/.test(rawPos)) {
    await ctx.reply({
      embeds: [errorEmbed(messages.remove.invalidPosition(queue.tracks.length))],
      ephemeral: true
    });
    return;
  }

  const position = Number.parseInt(rawPos, 10);
  const removed = queue.removeAt(position);
  if (!removed) {
    await ctx.reply({
      embeds: [errorEmbed(messages.remove.invalidPosition(queue.tracks.length))],
      ephemeral: true
    });
    return;
  }

  await ctx.reply({ embeds: [infoEmbed(messages.remove.removed(removed.title, position))] });
}
