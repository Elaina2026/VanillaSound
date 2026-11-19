import messages from '../messages.js';
import { advanceQueue, getAvailableNode } from '../music/manager.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';

export const name = 'skip';
export const aliases = ['s', 'next'];
export const description = 'Skip the currently playing track.';
export const slashOptions = [];

/**
 * Skips the current track and starts the next one if queued.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  const check = await requireSameVoiceChannel(ctx, { requireCurrentTrack: true });
  if (!check.ok) return;

  if (!getAvailableNode(ctx.client.shoukaku)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.nodeUnavailable)], ephemeral: true });
    return;
  }

  const { queue } = check;
  const skippedTitle = queue.current.title;

  if (queue.tracks.length > 0) {
    queue.suppressEndReasons += 1;
  }

  await advanceQueue(ctx.client, queue, true);
  await ctx.reply({ embeds: [infoEmbed(messages.skip.skipped(skippedTitle))] });
}
