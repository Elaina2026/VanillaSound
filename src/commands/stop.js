import messages from '../messages.js';
import { getAvailableNode, scheduleIdleLeave, stopPlayback } from '../music/manager.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';

export const name = 'stop';
export const aliases = [];
export const description = 'Stop playback and clear the queue while staying in voice.';
export const slashOptions = [];

/**
 * Stops current playback and clears the upcoming queue without disconnecting.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  const check = await requireSameVoiceChannel(ctx, { requireCurrentTrack: false });
  if (!check.ok) return;

  if (!getAvailableNode(ctx.client.shoukaku)) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.nodeUnavailable)], ephemeral: true });
    return;
  }

  const { queue } = check;
  if (!queue) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return;
  }

  await stopPlayback(queue);
  if (!queue.stay247) {
    scheduleIdleLeave(ctx.client, queue);
  }

  await ctx.reply({ embeds: [infoEmbed(messages.stop.stopped)] });
}
