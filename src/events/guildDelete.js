import { Events } from 'discord.js';
import config from '../config.js';
import { destroyGuild } from '../music/manager.js';
import { remove247Entry } from '../music/stay247.js';

export const name = Events.GuildDelete;
export const once = false;

/**
 * Cleans all per-guild queues and 24/7 entries when the bot is removed from a server.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<void>}
 */
export async function execute(guild) {
  console.log(`[${config.brandName}] Removed from guild ${guild.id}. Cleaning state.`);
  await remove247Entry(guild.id);
  await destroyGuild(guild.client, guild.id);
}
