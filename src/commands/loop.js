import { ApplicationCommandOptionType } from 'discord.js';
import messages from '../messages.js';
import { errorEmbed, infoEmbed } from '../utils/embeds.js';
import { requireSameVoiceChannel } from '../utils/voiceGuard.js';

const VALID_MODES = new Set(['off', 'track', 'queue']);

export const name = 'loop';
export const aliases = ['repeat'];
export const description = 'Show or set the loop mode (off, track, or queue).';

export const slashOptions = [
  {
    type: ApplicationCommandOptionType.String,
    name: 'mode',
    description: 'Loop mode to apply',
    required: false,
    choices: [
      { name: 'Off', value: 'off' },
      { name: 'Track', value: 'track' },
      { name: 'Queue', value: 'queue' }
    ]
  }
];

/**
 * Displays or updates the guild queue's loop mode.
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

  if (ctx.args[0] === undefined) {
    const label = messages.loopModes[queue.loopMode] || messages.loopModes.off;
    await ctx.reply({ embeds: [infoEmbed(messages.loop.currentMode(label))] });
    return;
  }

  const mode = ctx.args[0].trim().toLowerCase();
  if (!VALID_MODES.has(mode)) {
    await ctx.reply({ embeds: [errorEmbed(messages.loop.invalidMode)], ephemeral: true });
    return;
  }

  queue.loopMode = mode;
  await ctx.reply({ embeds: [infoEmbed(messages.loop.updated(messages.loopModes[mode]))] });
}
