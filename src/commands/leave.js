import { PermissionsBitField } from 'discord.js';
import config from '../config.js';
import messages from '../messages.js';
import { destroyGuild, getQueue } from '../music/manager.js';
import { is247Enabled, remove247Entry } from '../music/stay247.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';

export const name = 'leave';
export const aliases = ['dc', 'disconnect'];
export const description = 'Disconnect from voice, clear the queue, and turn 24/7 mode off.';
export const slashOptions = [];

/**
 * Disconnects from the voice channel, clears guild state, and disables 24/7 mode if active.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  if (!ctx.guild) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.guildOnly)], ephemeral: true });
    return;
  }

  const botChannel = ctx.guild.members.me?.voice?.channel || null;
  const userChannel = ctx.member?.voice?.channel || null;
  const queue = getQueue(ctx.guild.id);
  const stayActive = is247Enabled(ctx.guild.id);

  if (!botChannel && (!queue || !queue.player) && !stayActive) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return;
  }

  if (botChannel) {
    if (!userChannel || userChannel.id !== botChannel.id) {
      await ctx.reply({ embeds: [errorEmbed(messages.common.wrongVoiceChannel)], ephemeral: true });
      return;
    }
  } else {
    const canManage =
      ctx.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
      ctx.user.id === config.ownerId;
    if (!userChannel && !canManage) {
      await ctx.reply({ embeds: [errorEmbed(messages.common.wrongVoiceChannel)], ephemeral: true });
      return;
    }
  }

  const was247 = await remove247Entry(ctx.guild.id);
  await destroyGuild(ctx.client, ctx.guild.id);

  const replyText = was247
    ? messages.leave.leftWith247Disabled
    : messages.leave.left;

  await ctx.reply({ embeds: [infoEmbed(replyText)] });
}
