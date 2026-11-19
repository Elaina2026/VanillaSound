import { ActivityType, Events, Routes, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { onDiscordReady } from '../music/stay247.js';

export const name = Events.ClientReady;
export const once = true;

/**
 * Converts a command module's slashOptions definition into a SlashCommandBuilder payload.
 * @param {object} command
 * @returns {object}
 */
function buildSlashCommandJson(command) {
  const builder = new SlashCommandBuilder()
    .setName(command.name)
    .setDescription(command.description);

  for (const opt of command.slashOptions || []) {
    if (opt.type === 3) {
      builder.addStringOption((o) => {
        o.setName(opt.name)
          .setDescription(opt.description)
          .setRequired(Boolean(opt.required));
        if (opt.autocomplete) o.setAutocomplete(true);
        if (Array.isArray(opt.choices)) o.addChoices(...opt.choices);
        return o;
      });
    } else if (opt.type === 4) {
      builder.addIntegerOption((o) => {
        o.setName(opt.name)
          .setDescription(opt.description)
          .setRequired(Boolean(opt.required));
        if (typeof opt.minValue === 'number') o.setMinValue(opt.minValue);
        if (typeof opt.maxValue === 'number') o.setMaxValue(opt.maxValue);
        if (Array.isArray(opt.choices)) o.addChoices(...opt.choices);
        return o;
      });
    }
  }

  return builder.toJSON();
}

/**
 * Registers slash commands either to a specific GUILD_ID (instant) or globally.
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function registerSlashCommands(client) {
  const appId = config.clientId || client.application?.id;
  if (!appId) {
    console.warn(`[${config.brandName}] Cannot register slash commands: missing CLIENT_ID.`);
    return;
  }

  const body = [...client.commands.values()].map(buildSlashCommandJson);

  try {
    if (config.guildId) {
      await client.rest.put(
        Routes.applicationGuildCommands(appId, config.guildId),
        { body }
      );
      console.log(
        `[${config.brandName}] Registered ${body.length} guild slash command(s) for guild ${config.guildId}.`
      );
    } else {
      await client.rest.put(Routes.applicationCommands(appId), { body });
      console.log(
        `[${config.brandName}] Registered ${body.length} global slash command(s).`
      );
    }
  } catch (error) {
    console.error(
      `[${config.brandName}] Failed to register slash commands:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Runs once when the Discord client is ready.
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
export async function execute(client) {
  console.log(`[${config.brandName}] Connected to Discord as ${client.user.tag}.`);

  client.user.setPresence({
    activities: [
      {
        name: `${config.brandName} | ${config.prefix}play`,
        type: ActivityType.Listening
      }
    ],
    status: 'online'
  });

  await registerSlashCommands(client);
  onDiscordReady(client);
}
