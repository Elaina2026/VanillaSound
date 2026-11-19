import { Events } from 'discord.js';
import config from '../config.js';
import { createPrefixContext, handleCommandError } from '../utils/context.js';

export const name = Events.MessageCreate;
export const once = false;

/**
 * Dispatches prefix commands while ignoring bots and DMs.
 * @param {import('discord.js').Message} message
 * @returns {Promise<void>}
 */
export async function execute(message) {
  if (message.author.bot) return;
  if (!message.guild || message.channel.isDMBased()) return;

  const prefix = config.prefix;
  if (!message.content.startsWith(prefix)) return;

  const rawBody = message.content.slice(prefix.length).trim();
  if (!rawBody) return;

  const parts = rawBody.split(/\s+/);
  const commandName = parts.shift()?.toLowerCase();
  if (!commandName) return;

  const client = message.client;
  const resolvedName = client.aliases.get(commandName) || commandName;
  const command = client.commands.get(resolvedName);
  if (!command) return;

  const ctx = createPrefixContext(message, parts);
  try {
    await command.execute(ctx);
  } catch (error) {
    await handleCommandError(ctx, error, command.name);
  }
}
