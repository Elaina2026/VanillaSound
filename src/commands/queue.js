import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import messages from '../messages.js';
import { getQueue } from '../music/manager.js';
import { errorEmbed, infoEmbed, queueEmbed } from '../utils/embeds.js';

const PAGE_SIZE = 10;
const COLLECTOR_TIMEOUT_MS = 60_000;

/**
 * Tracks message IDs with an active pagination collector so interactionCreate can
 * safely tell users when buttons on an old or post-restart message have expired.
 * @type {Set<string>}
 */
export const activeQueueCollectors = new Set();

export const name = 'queue';
export const aliases = ['q'];
export const description = 'Show the current playback queue with pagination.';

export const slashOptions = [
  {
    type: ApplicationCommandOptionType.Integer,
    name: 'page',
    description: 'Page number to view',
    required: false,
    minValue: 1
  }
];

/**
 * Builds the Previous / Next pagination row.
 * @param {number} page
 * @param {number} totalPages
 * @param {boolean} [forceDisabled=false]
 * @returns {ActionRowBuilder}
 */
function buildPaginationRow(page, totalPages, forceDisabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('queue_prev')
      .setLabel(messages.queue.prevButton)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(forceDisabled || page <= 1),
    new ButtonBuilder()
      .setCustomId('queue_next')
      .setLabel(messages.queue.nextButton)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(forceDisabled || page >= totalPages)
  );
}

/**
 * Renders the queue embed for a given 1-based page.
 * @param {import('../music/queue.js').Queue} queue
 * @param {number} page
 * @returns {import('discord.js').EmbedBuilder}
 */
function renderQueuePage(queue, page) {
  const totalPages = Math.max(1, Math.ceil(queue.tracks.length / PAGE_SIZE));
  const safePage = Math.min(totalPages, Math.max(1, page));
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const slice = queue.tracks.slice(startIndex, startIndex + PAGE_SIZE);
  return queueEmbed(queue, safePage, totalPages, slice, startIndex);
}

/**
 * Displays a paginated view of the guild queue.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  if (!ctx.guild) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.guildOnly)], ephemeral: true });
    return;
  }

  const queue = getQueue(ctx.guild.id);
  if (!queue || (!queue.current && queue.tracks.length === 0)) {
    await ctx.reply({ embeds: [infoEmbed(messages.queue.empty)] });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(queue.tracks.length / PAGE_SIZE));
  let currentPage = 1;

  if (ctx.args[0] !== undefined) {
    const parsed = Number.parseInt(ctx.args[0], 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > totalPages) {
      await ctx.reply({
        embeds: [errorEmbed(messages.queue.invalidPage(totalPages))],
        ephemeral: true
      });
      return;
    }
    currentPage = parsed;
  }

  const hasMultiplePages = totalPages > 1;
  const rawReply = await ctx.reply({
    embeds: [renderQueuePage(queue, currentPage)],
    components: [buildPaginationRow(currentPage, totalPages, !hasMultiplePages)]
  });

  if (!hasMultiplePages || !rawReply) {
    return;
  }

  const replyMessage =
    typeof rawReply.fetch === 'function' ? await rawReply.fetch().catch(() => rawReply) : rawReply;

  if (!replyMessage || typeof replyMessage.createMessageComponentCollector !== 'function') {
    return;
  }

  const messageId = replyMessage.id;
  if (messageId) {
    activeQueueCollectors.add(messageId);
  }

  const collector = replyMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT_MS
  });

  collector.on('collect', async (buttonInteraction) => {
    try {
      const latestQueue = getQueue(ctx.guild.id);
      if (!latestQueue || (!latestQueue.current && latestQueue.tracks.length === 0)) {
        collector.stop('empty');
        await buttonInteraction.update({
          embeds: [infoEmbed(messages.queue.empty)],
          components: []
        });
        return;
      }

      const latestTotalPages = Math.max(1, Math.ceil(latestQueue.tracks.length / PAGE_SIZE));
      if (buttonInteraction.customId === 'queue_prev' && currentPage > 1) {
        currentPage -= 1;
      } else if (buttonInteraction.customId === 'queue_next' && currentPage < latestTotalPages) {
        currentPage += 1;
      }
      currentPage = Math.min(latestTotalPages, Math.max(1, currentPage));

      await buttonInteraction.update({
        embeds: [renderQueuePage(latestQueue, currentPage)],
        components: [buildPaginationRow(currentPage, latestTotalPages)]
      });
    } catch {
      // Ignore transient interaction update errors
    }
  });

  collector.on('end', async () => {
    if (messageId) {
      activeQueueCollectors.delete(messageId);
    }
    try {
      const latestQueue = getQueue(ctx.guild.id);
      const latestTotalPages = latestQueue
        ? Math.max(1, Math.ceil(latestQueue.tracks.length / PAGE_SIZE))
        : 1;
      const disabledRow = buildPaginationRow(currentPage, latestTotalPages, true);
      if (typeof replyMessage.edit === 'function') {
        await replyMessage.edit({ components: [disabledRow] }).catch(() => {});
      }
    } catch {
      // Message may have been deleted
    }
  });
}
