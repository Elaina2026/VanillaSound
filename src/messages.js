/**
 * Centralized user-facing strings for VanillaSound.
 * Kept in one module without emojis to make future localization straightforward.
 */

export const messages = {
  common: {
    errorTitle: 'Error',
    infoTitle: 'Notice',
    guildOnly: 'Run this command inside a server text channel.',
    nodeUnavailable: 'The audio server is not available, try again shortly.',
    unexpectedError: 'Something went wrong while running that command. Please try again shortly.',
    noActivePlayer: 'Nothing is playing right now. Use play to start a track.',
    needVoiceChannel: 'Join a voice channel first, then run the command again.',
    wrongVoiceChannel: 'Join my current voice channel before using playback controls.',
    alreadyInOtherChannel: (channelName) =>
      `I am already connected to ${channelName}. Join that channel to queue tracks.`,
    missingVoicePermissions: (channelName, missingList) =>
      `I need ${missingList} permission in ${channelName}. Grant those permissions and try again.`,
    queryTooLong: (max) => `Your query is too long. Keep it under ${max} characters.`,
    emptyQuery: 'Provide a song name or a YouTube, SoundCloud, or Spotify link.',
    unknownSubcommand: 'That option is not valid. Check the command usage and try again.',
    buttonExpired: 'Those controls have expired. Run the queue command again.',
    requesterUnknown: 'Unknown',
    liveLabel: 'LIVE',
    unknownSource: 'Unknown',
    none: 'None'
  },

  sources: {
    youtube: 'YouTube',
    ytmusic: 'YouTube Music',
    soundcloud: 'SoundCloud',
    spotify: 'Spotify'
  },

  loopModes: {
    off: 'Off',
    track: 'Track',
    queue: 'Queue'
  },

  play: {
    noResults: 'No tracks matched your search. Try different keywords or a direct link.',
    loadFailed: (reason) => `Could not load that track (${reason}). Try another query or link.`,
    trackQueued: (position) => `Added to queue at position #${position}.`,
    playingNow: 'Starting playback now.',
    playlistQueued: (name, added, skipped) => {
      if (skipped > 0) {
        return `Added ${added} tracks from "${name}". Skipped ${skipped} tracks due to the 50-track limit.`;
      }
      return `Added ${added} tracks from "${name}".`;
    },
    embedTrackTitle: 'Track Queued',
    embedPlaylistTitle: 'Playlist Queued',
    fieldArtist: 'Artist',
    fieldDuration: 'Duration',
    fieldSource: 'Source',
    fieldPosition: 'Queue Position',
    fieldTracksAdded: 'Tracks Added',
    fieldTracksSkipped: 'Skipped (50-Track Cap)'
  },

  nowPlaying: {
    title: 'Now Playing',
    trackStartedTitle: 'Now Playing',
    fieldAuthor: 'Author',
    fieldSource: 'Source',
    fieldProgress: 'Progress',
    fieldRequester: 'Requested By',
    fieldLoop: 'Loop Mode',
    fieldStay247: '24/7 Mode',
    stay247On: 'On',
    stay247Off: 'Off'
  },

  skip: {
    skipped: (title) => `Skipped "${title}".`,
    nothingToSkip: 'There is no track playing right now. Use play to add one.'
  },

  stop: {
    stopped: 'Stopped playback and cleared the upcoming queue. I will remain in the voice channel.'
  },

  pause: {
    alreadyPaused: 'Playback is already paused. Use resume to continue.',
    paused: (title) => `Paused "${title}".`
  },

  resume: {
    notPaused: 'Playback is not paused right now.',
    resumed: (title) => `Resumed "${title}".`
  },

  volume: {
    invalidRange: 'Provide a volume between 0 and 100.',
    currentVolume: (volume) => `Current volume is ${volume}%.`,
    updated: (volume) => `Volume set to ${volume}%.`
  },

  loop: {
    invalidMode: 'Choose one of: off, track, or queue.',
    currentMode: (modeLabel) => `Current loop mode is ${modeLabel}.`,
    updated: (modeLabel) => `Loop mode set to ${modeLabel}.`
  },

  shuffle: {
    notEnoughTracks: 'Add at least two upcoming tracks before shuffling the queue.',
    shuffled: (count) => `Shuffled ${count} upcoming tracks.`
  },

  remove: {
    emptyQueue: 'There are no upcoming tracks in the queue.',
    invalidPosition: (max) => `Provide a queue position between 1 and ${max}.`,
    removed: (title, position) => `Removed #${position}: "${title}".`
  },

  seek: {
    notSeekable: 'This track does not support seeking.',
    invalidTimestamp: 'Provide a valid timestamp such as 1:30 or 90.',
    outOfRange: (maxFormatted) => `Choose a timestamp between 0:00 and ${maxFormatted}.`,
    seeked: (formatted) => `Seeked to ${formatted}.`
  },

  leave: {
    left: 'Disconnected from the voice channel and cleared the queue.',
    leftWith247Disabled: 'Disconnected from the voice channel, cleared the queue, and turned 24/7 mode off for this server.'
  },

  queue: {
    title: 'Playback Queue',
    empty: 'The queue is empty. Use play to add a track.',
    nowPlayingHeader: 'Now Playing',
    upcomingHeader: 'Upcoming Tracks',
    noUpcoming: 'No upcoming tracks queued.',
    footerSummary: (page, totalPages, totalTracks, totalDuration) =>
      `Page ${page}/${totalPages} | ${totalTracks} upcoming | Total remaining: ${totalDuration}`,
    prevButton: 'Previous',
    nextButton: 'Next',
    invalidPage: (totalPages) => `Page not found. Choose a page between 1 and ${totalPages}.`
  },

  stay247: {
    noPermission: 'You need the Manage Server permission (or be the bot owner) to manage 24/7 mode.',
    enabled: (channelName) =>
      `24/7 mode is now ON for ${channelName}. I will stay connected across restarts and idle periods.`,
    disabled: '24/7 mode is now OFF. Normal auto-leave rules now apply.',
    alreadyOff: '24/7 mode is already OFF in this server.',
    statusTitle: '24/7 Mode Status',
    statusState: 'State',
    statusChannel: 'Saved Voice Channel',
    statusConnected: 'Connected Now',
    statusOn: 'Enabled',
    statusOff: 'Disabled',
    yes: 'Yes',
    no: 'No',
    missingChannelRemoved:
      'The saved 24/7 voice channel is no longer available or I lost permissions for it, so 24/7 mode was turned off.',
    channelDeletedDisabled:
      'The saved 24/7 voice channel was deleted, so 24/7 mode has been turned off for this server.'
  },

  events: {
    trackException: (title, reason) =>
      `Skipped "${title}" because playback failed: ${reason}.`,
    fallbackLoaded: (count) =>
      `Queue is empty. Loaded ${count} tracks from the configured fallback playlist.`,
    fallbackFailed: 'Could not load the configured fallback playlist. Staying connected silently.',
    idleDisconnect: 'Left the voice channel due to inactivity.',
    emptyChannelDisconnect: 'Left the voice channel because no listeners remained.'
  }
};

export default messages;
