import { ApplicationCommandOptionType } from 'discord.js';
import messages from '../messages.js';
import { getAvailableNode } from '../music/manager.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';

export const name = 'volume';
export const aliases = ['vol'];
export const description = 'Show or set the playback volume (0-100).';

export const slashOptions = [
  {
    type: ApplicationCommandOptionType.Integer,
    name: 'level',
    description: 'Volume percentage from 0 to 100',
    required: false,
    minValue: 0,
    maxValue: 100
  }
];

/**
 * Shows or updates the guild player's global volume.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  const check = await requireSameVoiceChannel(ctx, { requireCurrentTrack: false });
  if (!check.ok) return;

  const { queue } = check;
  if (!queue || !queue.player) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return;
  }

  if (ctx.args[0] === undefined) {
    await ctx.reply({ embeds: [infoEmbed(messages.volume.currentVolume(queue.volume))] });
    return;
  }

  if (!/^\d+$/.test(ctx.args[0].trim())) {
    await ctx.reply({ embeds: [errorEmbed(messages.volume.invalidRange)], ephemeral: true });
    return;
  }

  const level = Number.parseInt(ctx.args[0].trim(), 10);
  if (!Number.isInteger(level) || level < 0 || level > 100) {
    await ctx.reply({ embeds: [errorEmbed(messages.volume.invalidRange)], ephemeral: true });
    return;
  }

  if (!getAvailableNode(ctx.client.shoukaku)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.nodeUnavailable)], ephemeral: true });
    return;
  }

  queue.volume = level;
  await queue.player.setGlobalVolume(level);
  await ctx.reply({ embeds: [infoEmbed(messages.volume.updated(level))] });
}
