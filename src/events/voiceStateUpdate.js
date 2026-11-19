import { Events } from 'discord.js';
import config from '../config.js';
import {
  destroyGuild,
  getQueue,
  scheduleEmptyChannelLeave
} from '../music/manager.js';
import {
  get247Entry,
  rejoinWithBackoff,
  set247Entry
} from '../music/stay247.js';

export const name = Events.VoiceStateUpdate;
export const once = false;

/**
 * Handles bot voice moves/kicks and human listener counts for auto-leave.
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 * @returns {Promise<void>}
 */
export async function execute(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const client = guild?.client;
  if (!guild || !client) return;

  const botId = client.user?.id;
  if (!botId) return;

  // 1. Bot's own voice state changed
  if (newState.id === botId || oldState.id === botId) {
    const entry = get247Entry(guild.id);

    // Bot was disconnected from voice (kicked by a moderator or dropped)
    if (oldState.channelId && !newState.channelId) {
      if (entry) {
        console.warn(
          `[${config.brandName}] Disconnected from 24/7 channel in guild ${guild.id}. Scheduling rejoin.`
        );
        const queue = getQueue(guild.id);
        if (queue?.player) {
          queue.player.removeAllListeners();
          queue.player = null;
        }
        await client.shoukaku?.leaveVoiceChannel(guild.id).catch(() => {});
        void rejoinWithBackoff(client, guild.id);
      } else {
        await destroyGuild(client, guild.id);
      }
      return;
    }

    // Bot was moved by a moderator to another voice channel
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      if (entry) {
        console.log(
          `[${config.brandName}] Moved to channel ${newState.channelId} in 24/7 guild ${guild.id}. Updating saved channel.`
        );
        await set247Entry(guild.id, newState.channelId, entry.textChannelId);
      } else {
        const queue = getQueue(guild.id);
        const targetChannel = newState.channel;
        if (queue && targetChannel) {
          const humans = targetChannel.members.filter((m) => !m.user.bot).size;
          if (humans === 0) {
            scheduleEmptyChannelLeave(client, queue, targetChannel);
          } else if (queue.emptyChannelTimer) {
            clearTimeout(queue.emptyChannelTimer);
            queue.emptyChannelTimer = null;
          }
        }
      }
    }
    return;
  }

  // 2. Human member joined, left, or moved
  const member = newState.member || oldState.member;
  if (member?.user?.bot) return;

  const botChannel = guild.members.me?.voice?.channel;
  if (!botChannel) return;

  const queue = getQueue(guild.id);
  if (!queue || queue.stay247 || get247Entry(guild.id)) return;

  if (oldState.channelId !== botChannel.id && newState.channelId !== botChannel.id) {
    return;
  }

  const humans = botChannel.members.filter((m) => !m.user.bot).size;
  if (humans === 0) {
    scheduleEmptyChannelLeave(client, queue, botChannel);
  } else if (queue.emptyChannelTimer) {
    clearTimeout(queue.emptyChannelTimer);
    queue.emptyChannelTimer = null;
  }
}
