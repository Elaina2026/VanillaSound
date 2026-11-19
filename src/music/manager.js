import { PermissionsBitField } from 'discord.js';
import config, { MAX_PLAYLIST_TRACKS } from '../config.js';
import messages from '../messages.js';
import { infoEmbed, nowPlayingEmbed } from '../utils/embeds.js';
import { Queue } from './queue.js';
import { compactTrack, resolveTracks } from './resolver.js';

/**
 * Per-guild Queue instances keyed by guildId.
 * Deleted whenever the bot leaves voice or is removed from a guild.
 * @type {Map<string, Queue>}
 */
const queues = new Map();

/**
 * Optional callback invoked to resolve saved 24/7 textChannelId fallback.
 * Registered by stay247.js to avoid circular import order issues.
 * @type {((guildId: string) => { voiceChannelId: string, textChannelId: string } | null) | null}
 */
let stay247Lookup = null;

/**
 * Registers the 24/7 entry lookup helper used for announcement channel fallback.
 * @param {(guildId: string) => { voiceChannelId: string, textChannelId: string } | null} fn
 */
export function setStay247Lookup(fn) {
  stay247Lookup = fn;
}

/**
 * Gets an existing Queue for a guild, or null if none exists.
 * @param {string} guildId
 * @returns {Queue | null}
 */
export function getQueue(guildId) {
  return queues.get(guildId) || null;
}

/**
 * Gets an existing Queue or creates a new one for the guild.
 * @param {string} guildId
 * @param {string | null} [textChannelId=null]
 * @param {boolean} [stay247=false]
 * @returns {Queue}
 */
export function getOrCreateQueue(guildId, textChannelId = null, stay247 = false) {
  let queue = queues.get(guildId);
  if (!queue) {
    const is247 = stay247 || Boolean(stay247Lookup?.(guildId));
    queue = new Queue(guildId, textChannelId, is247);
    queues.set(guildId, queue);
  } else if (textChannelId) {
    queue.textChannelId = textChannelId;
  }
  return queue;
}

/**
 * Returns all active queue guild IDs.
 * @returns {string[]}
 */
export function getActiveGuildIds() {
  return [...queues.keys()];
}

/**
 * Returns the first connected NodeLink node from Shoukaku, or null if unavailable.
 * @param {import('shoukaku').Shoukaku} shoukaku
 * @returns {import('shoukaku').Node | null}
 */
export function getAvailableNode(shoukaku) {
  if (!shoukaku) return null;
  return shoukaku.options.nodeResolver(shoukaku.nodes) || null;
}

/**
 * Checks whether the bot has Connect and Speak permissions in a voice channel.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').VoiceBasedChannel} voiceChannel
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkVoicePermissions(guild, voiceChannel) {
  const me = guild.members.me;
  if (!me || !voiceChannel) {
    return { ok: false, missing: ['Connect', 'Speak'] };
  }

  const perms = voiceChannel.permissionsFor(me);
  if (!perms) {
    return { ok: false, missing: ['Connect', 'Speak'] };
  }

  const missing = [];
  if (!perms.has(PermissionsBitField.Flags.Connect)) missing.push('Connect');
  if (!perms.has(PermissionsBitField.Flags.Speak)) missing.push('Speak');

  return { ok: missing.length === 0, missing };
}

/**
 * Resolves the best text channel for announcements:
 * last command channel first, falling back to saved 24/7 textChannelId.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @returns {Promise<import('discord.js').TextBasedChannel | null>}
 */
async function resolveAnnouncementChannel(client, queue) {
  const savedChannelId = stay247Lookup?.(queue.guildId)?.textChannelId || null;
  const candidateIds = [queue.textChannelId, savedChannelId].filter(Boolean);

  for (const channelId of candidateIds) {
    try {
      const channel =
        client.channels.cache.get(channelId) ||
        (await client.channels.fetch(channelId).catch(() => null));
      if (channel && channel.isTextBased() && !channel.isDMBased()) {
        return channel;
      }
    } catch {
      // Try fallback ID if primary channel is inaccessible
    }
  }
  return null;
}

/**
 * Sends an informational notice to the guild's resolved text channel.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @param {string} text
 * @returns {Promise<void>}
 */
async function sendQueueNotice(client, queue, text) {
  const channel = await resolveAnnouncementChannel(client, queue);
  if (!channel) return;
  await channel.send({ embeds: [infoEmbed(text)] }).catch(() => {});
}

/**
 * Announces the current track once, deleting the previous announcement to avoid spam.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @returns {Promise<void>}
 */
async function announceNowPlaying(client, queue) {
  const track = queue.current;
  if (!track) return;
  if (queue.lastAnnouncedTrackInstanceId === track.instanceId) return;
  queue.lastAnnouncedTrackInstanceId = track.instanceId;

  const channel = await resolveAnnouncementChannel(client, queue);
  if (!channel) return;

  if (queue.lastAnnouncementMessageId) {
    const oldMsgId = queue.lastAnnouncementMessageId;
    queue.lastAnnouncementMessageId = null;
    await channel.messages.delete(oldMsgId).catch(() => {});
  }

  const sent = await channel
    .send({ embeds: [nowPlayingEmbed(queue, messages.nowPlaying.trackStartedTitle)] })
    .catch(() => null);

  if (sent) {
    queue.lastAnnouncementMessageId = sent.id;
  }
}

/**
 * Schedules idle auto-leave if 24/7 mode is off and playback is idle.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 */
export function scheduleIdleLeave(client, queue) {
  if (!queue || queue.stay247) return;
  if (queue.idleTimer) {
    clearTimeout(queue.idleTimer);
    queue.idleTimer = null;
  }

  queue.idleTimer = setTimeout(async () => {
    queue.idleTimer = null;
    const active = queues.get(queue.guildId);
    if (!active || active.stay247 || active.current || active.tracks.length > 0) {
      return;
    }

    await sendQueueNotice(client, active, messages.events.idleDisconnect);
    await destroyGuild(client, active.guildId);
  }, config.idleLeaveSeconds * 1000);
}

/**
 * Schedules empty-channel auto-leave if 24/7 mode is off and no humans remain.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @param {import('discord.js').VoiceBasedChannel} voiceChannel
 */
export function scheduleEmptyChannelLeave(client, queue, voiceChannel) {
  if (!queue || queue.stay247) return;
  if (queue.emptyChannelTimer) return;

  queue.emptyChannelTimer = setTimeout(async () => {
    queue.emptyChannelTimer = null;
    const active = queues.get(queue.guildId);
    if (!active || active.stay247) return;

    const guild = client.guilds.cache.get(active.guildId);
    const currentChannel =
      guild?.members.me?.voice?.channel || voiceChannel;
    if (currentChannel) {
      const humans = currentChannel.members.filter((m) => !m.user.bot).size;
      if (humans > 0) return;
    }

    await sendQueueNotice(client, active, messages.events.emptyChannelDisconnect);
    await destroyGuild(client, active.guildId);
  }, config.idleLeaveSeconds * 1000);
}

/**
 * Loads the configured FALLBACK_PLAYLIST_URL in a 24/7 guild when the queue empties.
 * Re-shuffles tracks each time it restarts.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @returns {Promise<boolean>} true if tracks were loaded and started
 */
async function tryPlayFallbackPlaylist(client, queue) {
  if (!queue.stay247 || !config.fallbackPlaylistUrl) return false;
  const node = getAvailableNode(client.shoukaku);
  if (!node) return false;

  try {
    const result = await resolveTracks(
      node,
      config.fallbackPlaylistUrl,
      client.user?.id || null,
      MAX_PLAYLIST_TRACKS
    );

    if (result.type === 'empty' || result.type === 'error' || result.tracks.length === 0) {
      await sendQueueNotice(client, queue, messages.events.fallbackFailed);
      return false;
    }

    queue.tracks.push(...result.tracks);
    if (queue.tracks.length > 1) {
      queue.shuffleUpcoming();
    }

    queue.current = queue.tracks.shift() || null;
    if (!queue.current) return false;

    await playCurrentTrack(client, queue);
    await sendQueueNotice(
      client,
      queue,
      messages.events.fallbackLoaded(result.tracks.length)
    );
    return true;
  } catch (error) {
    console.error(
      `[${config.brandName}] Fallback playlist load failed for guild ${queue.guildId}:`,
      error instanceof Error ? error.message : String(error)
    );
    await sendQueueNotice(client, queue, messages.events.fallbackFailed);
    return false;
  }
}

/**
 * Plays `queue.current` on the guild's Shoukaku player.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @param {number} [startPosition=0]
 * @returns {Promise<void>}
 */
export async function playCurrentTrack(client, queue, startPosition = 0) {
  if (!queue.current || !queue.player) return;
  queue.clearTimers();

  const playOptions = {
    track: { encoded: queue.current.encoded },
    volume: queue.volume
  };

  if (startPosition > 0) {
    playOptions.position = startPosition;
  }

  await queue.player.playTrack(playOptions);
}

/**
 * Advances to the next track according to loop mode, or triggers idle/fallback behavior.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @param {boolean} [fromSkip=false]
 * @returns {Promise<void>}
 */
export async function advanceQueue(client, queue, fromSkip = false) {
  if (!queue) return;
  const previous = queue.current;

  if (!fromSkip && queue.loopMode === 'track' && previous) {
    await playCurrentTrack(client, queue);
    return;
  }

  if (!fromSkip && queue.loopMode === 'queue' && previous) {
    // Re-wrap with a fresh instanceId so it announces again on its next turn.
    const recycled = compactTrack(
      { encoded: previous.encoded, info: previous },
      previous.requesterId
    );
    queue.tracks.push(recycled);
  }

  queue.current = queue.tracks.shift() || null;

  if (queue.current) {
    await playCurrentTrack(client, queue);
    return;
  }

  // Queue is now empty
  if (fromSkip && queue.player) {
    queue.suppressEndReasons += 1;
    await queue.player.stopTrack().catch(() => {});
  }

  if (queue.stay247) {
    const startedFallback = await tryPlayFallbackPlaylist(client, queue);
    if (!startedFallback) {
      // Stay connected silently
      queue.clearTimers();
    }
    return;
  }

  scheduleIdleLeave(client, queue);
}

/**
 * Attaches NodeLink/Shoukaku player event listeners cleanly without duplicates.
 * @param {import('discord.js').Client} client
 * @param {Queue} queue
 * @param {import('shoukaku').Player} player
 */
export function attachPlayerListeners(client, queue, player) {
  player.removeAllListeners();
  queue.player = player;

  let handledExceptionTrackId = null;

  player.on('start', async () => {
    const active = queues.get(queue.guildId);
    if (!active || active.player !== player) return;
    await announceNowPlaying(client, active).catch(() => {});
  });

  player.on('end', async (data) => {
    const active = queues.get(queue.guildId);
    if (!active || active.player !== player) return;

    const reason = data?.reason;

    // Ignore replaced/stopped events triggered by our own skip or stop calls.
    if ((reason === 'replaced' || reason === 'stopped') && active.suppressEndReasons > 0) {
      active.suppressEndReasons -= 1;
      return;
    }

    if (reason === 'replaced' || reason === 'stopped' || reason === 'cleanup') {
      return;
    }

    if (reason === 'loadFailed' && handledExceptionTrackId === active.current?.instanceId) {
      handledExceptionTrackId = null;
      return;
    }

    await advanceQueue(client, active, false).catch((error) => {
      console.error(
        `[${config.brandName}] Error advancing queue in guild ${active.guildId}:`,
        error instanceof Error ? error.message : String(error)
      );
    });
  });

  player.on('exception', async (data) => {
    const active = queues.get(queue.guildId);
    if (!active || active.player !== player) return;

    const failedTrack = active.current;
    const shortReason = data?.exception?.message || 'playback error';
    console.error(
      `[${config.brandName}] Player exception in guild ${active.guildId}: ${shortReason}`
    );

    if (failedTrack) {
      handledExceptionTrackId = failedTrack.instanceId;
      await sendQueueNotice(
        client,
        active,
        messages.events.trackException(failedTrack.title, shortReason)
      );
    }

    await advanceQueue(client, active, true).catch((error) => {
      console.error(
        `[${config.brandName}] Failed to recover after track exception in guild ${active.guildId}:`,
        error instanceof Error ? error.message : String(error)
      );
    });
  });

  player.on('stuck', (data) => {
    // NodeLink emits stuck only as an informational threshold event; do not rely on it for recovery.
    console.warn(
      `[${config.brandName}] Track stuck notice in guild ${queue.guildId} (${data?.thresholdMs ?? 0}ms).`
    );
  });

  player.on('closed', (data) => {
    console.warn(
      `[${config.brandName}] Voice socket closed in guild ${queue.guildId} (code=${data?.code}, byRemote=${Boolean(data?.byRemote)}).`
    );
  });

  player.on('update', () => {
    // Shoukaku internally updates player.position and player.ping from playerUpdate frames.
  });
}

/**
 * Joins a voice channel (if not already connected) and ensures a Shoukaku player is ready.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').VoiceBasedChannel} voiceChannel
 * @param {string | null} [textChannelId=null]
 * @returns {Promise<{ queue: Queue, player: import('shoukaku').Player }>}
 */
export async function connectToVoice(client, guild, voiceChannel, textChannelId = null) {
  const shoukaku = client.shoukaku;
  const queue = getOrCreateQueue(guild.id, textChannelId);

  let player = shoukaku.players.get(guild.id);
  if (player) {
    attachPlayerListeners(client, queue, player);
    return { queue, player };
  }

  // Clean up any dangling Shoukaku connection before creating a fresh player.
  if (shoukaku.connections.has(guild.id)) {
    await shoukaku.leaveVoiceChannel(guild.id).catch(() => {});
  }

  player = await shoukaku.joinVoiceChannel({
    guildId: guild.id,
    channelId: voiceChannel.id,
    shardId: guild.shardId || 0,
    deaf: true
  });

  attachPlayerListeners(client, queue, player);
  await player.setGlobalVolume(queue.volume).catch(() => {});
  return { queue, player };
}

/**
 * Stops playback and clears upcoming tracks while keeping the voice connection alive.
 * @param {Queue} queue
 * @returns {Promise<void>}
 */
export async function stopPlayback(queue) {
  if (!queue) return;
  queue.clearUpcoming();
  const hadTrack = Boolean(queue.current);
  queue.current = null;
  queue.lastAnnouncedTrackInstanceId = null;

  if (queue.player && hadTrack) {
    queue.suppressEndReasons += 1;
    await queue.player.stopTrack().catch(() => {});
  }
}

/**
 * Disconnects from voice and completely cleans up guild queue state.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {Promise<void>}
 */
export async function destroyGuild(client, guildId) {
  const queue = queues.get(guildId);
  if (queue) {
    queue.clearTimers();
    queue.clearUpcoming();
    queue.current = null;
    if (queue.player) {
      queue.player.removeAllListeners();
      queue.player = null;
    }
    queues.delete(guildId);
  }

  if (client.shoukaku) {
    await client.shoukaku.leaveVoiceChannel(guildId).catch(() => {});
  }
}

/**
 * Gracefully destroys all players and disconnects all voice connections on shutdown.
 * Does not modify the persistent 24/7 state file.
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
export async function shutdownAllPlayers(client) {
  const guildIds = new Set([
    ...queues.keys(),
    ...(client.shoukaku ? client.shoukaku.players.keys() : []),
    ...(client.shoukaku ? client.shoukaku.connections.keys() : [])
  ]);

  for (const guildId of guildIds) {
    await destroyGuild(client, guildId);
  }
}
