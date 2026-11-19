import config from '../config.js';

/**
 * Per-guild playback state and track queue.
 */
export class Queue {
  /**
   * @param {string} guildId
   * @param {string | null} [textChannelId=null]
   * @param {boolean} [stay247=false]
   */
  constructor(guildId, textChannelId = null, stay247 = false) {
    this.guildId = guildId;
    this.current = null;
    this.tracks = [];
    this.loopMode = 'off'; // 'off' | 'track' | 'queue'
    this.volume = config.defaultVolume;
    this.textChannelId = textChannelId;
    this.lastAnnouncementMessageId = null;
    this.lastAnnouncedTrackInstanceId = null;
    this.idleTimer = null;
    this.emptyChannelTimer = null;
    this.stay247 = stay247;
    this.player = null;
    this.suppressEndReasons = 0;
  }

  /**
   * Clears any pending idle or empty-channel disconnect timers.
   */
  clearTimers() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.emptyChannelTimer) {
      clearTimeout(this.emptyChannelTimer);
      this.emptyChannelTimer = null;
    }
  }

  /**
   * Clears all upcoming tracks without altering the currently playing track.
   */
  clearUpcoming() {
    this.tracks.length = 0;
  }

  /**
   * Computes total remaining duration in milliseconds (current remaining + upcoming).
   * @returns {number}
   */
  getTotalRemainingDuration() {
    let total = 0;
    if (this.current && !this.current.isStream && this.current.length > 0) {
      const elapsed = this.player ? Math.max(0, this.player.position || 0) : 0;
      total += Math.max(0, this.current.length - elapsed);
    }
    for (const track of this.tracks) {
      if (!track.isStream && track.length > 0) {
        total += track.length;
      }
    }
    return total;
  }

  /**
   * Shuffles only the upcoming tracks in place using Fisher-Yates.
   * @returns {number} Number of tracks shuffled
   */
  shuffleUpcoming() {
    for (let i = this.tracks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    return this.tracks.length;
  }

  /**
   * Removes an upcoming track by 1-based position.
   * @param {number} position
   * @returns {object | null}
   */
  removeAt(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.tracks.length) {
      return null;
    }
    const [removed] = this.tracks.splice(position - 1, 1);
    return removed || null;
  }
}

export default Queue;
