import { ApplicationCommandOptionType, PermissionsBitField } from 'discord.js';
import config from '../config.js';
import messages from '../messages.js';
import {
  checkVoicePermissions,
  connectToVoice,
  getAvailableNode,
  getQueue,
  scheduleEmptyChannelLeave,
  scheduleIdleLeave
} from '../music/manager.js';
import {
  get247Entry,
  is247Enabled,
  remove247Entry,
  set247Entry
} from '../music/stay247.js';
import { errorEmbed, infoEmbed, status247Embed } from '../utils/embeds.js';

export const name = '247';
export const aliases = ['stay', 'stay247'];
export const description = 'Configure or check persistent 24/7 voice mode for this server.';

export const slashOptions = [
  {
    type: ApplicationCommandOptionType.String,
    name: 'mode',
    description: 'Action to perform (omit to toggle on/off)',
    required: false,
    choices: [
      { name: 'On', value: 'on' },
      { name: 'Off', value: 'off' },
      { name: 'Status', value: 'status' }
    ]
  }
];

/**
 * Checks whether the invoking member has Manage Server permission or matches OWNER_ID.
 * @param {object} ctx
 * @returns {boolean}
 */
function has247Permission(ctx) {
  if (config.ownerId && ctx.user.id === config.ownerId) {
    return true;
  }
  return Boolean(ctx.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild));
}

/**
 * Enables, disables, toggles, or reports 24/7 mode for the guild.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  if (!ctx.guild) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.guildOnly)], ephemeral: true });
    return;
  }

  if (!has247Permission(ctx)) {
    await ctx.reply({ embeds: [errorEmbed(messages.stay247.noPermission)], ephemeral: true });
    return;
  }

  const rawArg = ctx.args[0]?.trim().toLowerCase();
  let action = rawArg;

  if (!action) {
    action = is247Enabled(ctx.guild.id) ? 'off' : 'on';
  }

  if (action !== 'on' && action !== 'off' && action !== 'status') {
    await ctx.reply({ embeds: [errorEmbed(messages.common.unknownSubcommand)], ephemeral: true });
    return;
  }

  if (action === 'status') {
    const entry = get247Entry(ctx.guild.id);
    const botChannelId = ctx.guild.members.me?.voice?.channelId || null;
    const connected = Boolean(entry && botChannelId === entry.voiceChannelId);
    await ctx.reply({
      embeds: [status247Embed(Boolean(entry), entry?.voiceChannelId || null, connected)]
    });
    return;
  }

  if (action === 'off') {
    const removed = await remove247Entry(ctx.guild.id);
    if (!removed) {
      await ctx.reply({ embeds: [infoEmbed(messages.stay247.alreadyOff)] });
      return;
    }

    const queue = getQueue(ctx.guild.id);
    const botChannel = ctx.guild.members.me?.voice?.channel || null;
    if (queue) {
      if (!queue.current && queue.tracks.length === 0) {
        scheduleIdleLeave(ctx.client, queue);
      }
      if (botChannel) {
        const humans = botChannel.members.filter((m) => !m.user.bot).size;
        if (humans === 0) {
          scheduleEmptyChannelLeave(ctx.client, queue, botChannel);
        }
      }
    }

    await ctx.reply({ embeds: [infoEmbed(messages.stay247.disabled)] });
    return;
  }

  // action === 'on'
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

  if (!botChannel) {
    if (!getAvailableNode(ctx.client.shoukaku)) {
      await ctx.reply({ embeds: [errorEmbed(messages.common.nodeUnavailable)], ephemeral: true });
      return;
    }
    await connectToVoice(ctx.client, ctx.guild, userChannel, ctx.channel.id);
  }

  await set247Entry(ctx.guild.id, userChannel.id, ctx.channel.id);
  await ctx.reply({ embeds: [infoEmbed(messages.stay247.enabled(userChannel.name))] });
}
