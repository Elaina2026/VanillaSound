import { Events } from 'discord.js';
import config from '../config.js';
import messages from '../messages.js';
import { destroyGuild } from '../music/manager.js';
import { get247Entry, remove247Entry } from '../music/stay247.js';
import { infoEmbed } from '../utils/embeds.js';

export const name = Events.ChannelDelete;
export const once = false;

/**
 * Turns off 24/7 mode and cleans guild state if a saved 24/7 voice channel is deleted.
 * @param {import('discord.js').Channel} channel
 * @returns {Promise<void>}
 */
export async function execute(channel) {
  if (!channel || !('guild' in channel) || !channel.guild) return;
  if (!channel.isVoiceBased?.()) return;

  const guild = channel.guild;
  const entry = get247Entry(guild.id);
  if (!entry || entry.voiceChannelId !== channel.id) return;

  console.warn(
    `[${config.brandName}] 24/7 voice channel ${channel.id} in guild ${guild.id} was deleted. Disabling 24/7 mode.`
  );

  await remove247Entry(guild.id);
  await destroyGuild(guild.client, guild.id);

  if (entry.textChannelId && entry.textChannelId !== channel.id) {
    const textChannel =
      guild.channels.cache.get(entry.textChannelId) ||
      (await guild.channels.fetch(entry.textChannelId).catch(() => null));
    if (textChannel && textChannel.isTextBased()) {
      await textChannel
        .send({ embeds: [infoEmbed(messages.stay247.channelDeletedDisabled)] })
        .catch(() => {});
    }
  }
}
