import { ActionRowBuilder, ButtonBuilder, Events, MessageFlags } from 'discord.js';
import { activeQueueCollectors } from '../commands/queue.js';
import messages from '../messages.js';
import { searchAutocomplete } from '../music/resolver.js';
import { createSlashContext, handleCommandError } from '../utils/context.js';
import { infoEmbed } from '../utils/embeds.js';

export const name = Events.InteractionCreate;
export const once = false;

/**
 * Builds disabled copies of existing message button rows when a queue collector has expired.
 * @param {import('discord.js').Message} message
 * @returns {ActionRowBuilder[]}
 */
function disableMessageButtons(message) {
  return (message.components || []).map((row) => {
    const newRow = new ActionRowBuilder();
    for (const component of row.components || []) {
      newRow.addComponents(ButtonBuilder.from(component).setDisabled(true));
    }
    return newRow;
  });
}

/**
 * Routes slash commands, autocomplete queries, and expired queue button interactions.
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<void>}
 */
export async function execute(interaction) {
  const client = interaction.client;

  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== 'play') {
      await interaction.respond([]).catch(() => {});
      return;
    }

    try {
      const focused = interaction.options.getFocused();
      const suggestions = await searchAutocomplete(client.shoukaku, focused);
      await interaction.respond(suggestions).catch(() => {});
    } catch {
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'queue_prev' || interaction.customId === 'queue_next') {
      if (activeQueueCollectors.has(interaction.message.id)) {
        return;
      }

      try {
        await interaction.reply({
          embeds: [infoEmbed(messages.common.buttonExpired)],
          flags: MessageFlags.Ephemeral
        });
        const disabled = disableMessageButtons(interaction.message);
        if (disabled.length > 0) {
          await interaction.message.edit({ components: disabled }).catch(() => {});
        }
      } catch {
        // Ignore stale interaction errors
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const ctx = createSlashContext(interaction);
  try {
    await command.execute(ctx);
  } catch (error) {
    await handleCommandError(ctx, error, command.name);
  }
}
