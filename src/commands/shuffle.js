import messages from '../messages.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';

export const name = 'shuffle';
export const aliases = ['sh'];
export const description = 'Shuffle the upcoming tracks in the queue.';
export const slashOptions = [];

/**
 * Shuffles upcoming tracks without touching the currently playing track.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function execute(ctx) {
  const check = await requireSameVoiceChannel(ctx, { requireCurrentTrack: false });
  if (!check.ok) return;

  const { queue } = check;
  if (!queue) {
    await ctx.reply({ embeds: [errorEmbed(messages.common.noActivePlayer)], ephemeral: true });
    return;
  }

  if (queue.tracks.length < 2) {
    await ctx.reply({ embeds: [errorEmbed(messages.shuffle.notEnoughTracks)], ephemeral: true });
    return;
  }

  const count = queue.shuffleUpcoming();
  await ctx.reply({ embeds: [infoEmbed(messages.shuffle.shuffled(count))] });
}
