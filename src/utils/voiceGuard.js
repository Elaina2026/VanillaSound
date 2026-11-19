import messages from '../messages.js';
import { getQueue } from '../music/manager.js';
import { errorEmbed } from './embeds.js';

/**
 * Verifies the command is run in a guild and the user is in the same voice channel as the bot.
 * @param {object} ctx
 * @param {{ requireCurrentTrack?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, queue?: import('../music/queue.js').Queue }>}
 */
export async function requireSameVoiceChannel(ctx, { requireCurrentTrack = false } = {}) {
  if (!ctx.guild) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.guildOnly)], ephemeral: true });
    return { ok: false };
  }

  const queue = getQueue(ctx.guild.id);
  const botChannel = ctx.guild.members.me?.voice?.channel || null;

  if (!botChannel && (!queue || !queue.player)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return { ok: false };
  }

  const userChannel = ctx.member?.voice?.channel || null;
  if (!userChannel || (botChannel && userChannel.id !== botChannel.id)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.wrongVoiceChannel)], ephemeral: true });
    return { ok: false };
  }

  if (requireCurrentTrack && (!queue || !queue.player || !queue.current)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return { ok: false };
  }

  return { ok: true, queue };
}
