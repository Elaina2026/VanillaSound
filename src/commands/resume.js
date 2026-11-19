import messages from '../messages.js';
import { getAvailableNode } from '../music/manager.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';

export const name = 'resume';
export const aliases = ['unpause'];
export const description = 'Resume a paused track.';
export const slashOptions = [];

/**
 * Resumes paused playback.
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
  if (!queue.player.paused) {
    await ctx.reply({ embeds: [infoEmbed(messages.resume.notPaused)], ephemeral: true });
    return;
  }

  await queue.player.setPaused(false);
  await ctx.reply({ embeds: [infoEmbed(messages.resume.resumed(queue.current.title))] });
}
