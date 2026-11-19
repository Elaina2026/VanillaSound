import { MessageFlags } from 'discord.js';
import config from '../config.js';
import messages from '../messages.js';
import { errorEmbed } from './embeds.js';

/**
 * Normalizes reply options across prefix messages and slash interactions.
 * @param {string | object} payload
 * @param {boolean} isSlash
 * @returns {object}
 */
function normalizeReplyPayload(payload, isSlash) {
  const base = typeof payload === 'string' ? { content: payload } : { ...payload };

  if (!isSlash) {
    delete base.ephemeral;
    delete base.flags;
    base.allowedMentions = { repliedUser: false };
    return base;
  }

  if (base.ephemeral) {
    delete base.ephemeral;
    base.flags = MessageFlags.Ephemeral;
  }
  return base;
}

/**
 * Extracts ordered string arguments from a slash command interaction.
 * For `play`, prepends the optional `source` switch before `query` so both
 * prefix and slash share identical parsing.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {string[]}
 */
function extractSlashArgs(interaction) {
  const args = [];
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand) {
    args.push(subcommand);
  }

  if (interaction.commandName === 'play') {
    const source = interaction.options.getString('source');
    const query = interaction.options.getString('query');
    if (source) args.push(source);
    if (query) args.push(query);
    return args;
  }

  const options = subcommand
    ? interaction.options.data[0]?.options || []
    : interaction.options.data;

  for (const option of options) {
    if (option.value !== undefined && option.value !== null) {
      args.push(String(option.value));
    }
  }

  return args;
}

/**
 * Creates a unified command context from a prefix Message.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 * @returns {object}
 */
export function createPrefixContext(message, args) {
  let sentMessage = null;

  return {
    guild: message.guild,
    member: message.member,
    channel: message.channel,
    user: message.author,
    args,
    isSlash: false,
    client: message.client,

    async deferReply() {
      await message.channel.sendTyping().catch(() => {});
    },

    async reply(payload) {
      const normalized = normalizeReplyPayload(payload, false);
      if (sentMessage) {
        return sentMessage.edit(normalized);
      }
      sentMessage = await message.reply(normalized);
      return sentMessage;
    }
  };
}

/**
 * Creates a unified command context from a ChatInputCommandInteraction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {object}
 */
export function createSlashContext(interaction) {
  const args = extractSlashArgs(interaction);

  return {
    guild: interaction.guild,
    member: interaction.member,
    channel: interaction.channel,
    user: interaction.user,
    args,
    isSlash: true,
    client: interaction.client,

    async deferReply(ephemeral = false) {
      if (interaction.deferred || interaction.replied) return;
      await interaction.deferReply(
        ephemeral ? { flags: MessageFlags.Ephemeral } : {}
      );
    },

    async reply(payload) {
      const normalized = normalizeReplyPayload(payload, true);
      if (interaction.deferred || interaction.replied) {
        // editReply does not accept flags after deferReply
        delete normalized.flags;
        return interaction.editReply(normalized);
      }
      return interaction.reply(normalized);
    }
  };
}

/**
 * Logs an unexpected command error and sends a friendly message to the user.
 * Never logs tokens or passwords.
 * @param {object} ctx
 * @param {unknown} error
 * @param {string} commandName
 * @returns {Promise<void>}
 */
export async function handleCommandError(ctx, error, commandName) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[${config.brandName}] Command "${commandName}" failed:`, detail);

  try {
    await ctx.reply({
      embeds: [errorEmbed(messages.common.unexpectedError)],
      ephemeral: true
    });
  } catch (replyError) {
    console.error(
      `[${config.brandName}] Failed to send error reply for "${commandName}":`,
      replyError instanceof Error ? replyError.message : String(replyError)
    );
  }
}
