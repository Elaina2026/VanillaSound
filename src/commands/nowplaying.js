import messages from '../messages.js';
import { getQueue } from '../music/manager.js';
import { errorEmbed, nowPlayingEmbed } from '../utils/embeds.js';

export const name = 'nowplaying';
export const aliases = ['np'];
export const description = 'Show details and progress for the currently playing track.';
export const slashOptions = [];

/**
 * Displays the currently playing track embed.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  if (!ctx.guild) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.guildOnly)], ephemeral: true });
    return;
  }

  const queue = getQueue(ctx.guild.id);
  if (!queue || !queue.current) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return;
  }

  await ctx.reply({ embeds: [nowPlayingEmbed(queue)] });
}
