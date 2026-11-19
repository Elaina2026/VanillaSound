You are a senior Node.js engineer. Build a complete, production-ready Discord music bot named "VanillaSound" for a private server, using discord.js v14 and Shoukaku v4 as the client library, connected to a NodeLink audio server (PerformanC/NodeLink, an audio server written in Node.js). The bot must support a persistent 24/7 mode. Deliver all files in full, with no placeholders, no TODOs and no omitted sections.

=====================================================
1. ENVIRONMENT AND HARD CONSTRAINTS
=====================================================
- Host: Pterodactyl panel with a Node.js-only egg. There is NO Java, NO Python, NO root access, and no package manager other than npm. Do not suggest apt, pip, Docker or sudo.
- Resources: 1 GB RAM, 100% CPU (one core), 20 GB disk. Network access is available.
- Language: JavaScript with ES modules ("type": "module" in package.json). No TypeScript, no build step.
- Node.js: v22 or higher (NodeLink requires it). Use only features available in Node 22.
- Two processes run inside the same container: (a) NodeLink listening on 127.0.0.1:2333, (b) this Discord bot. The bot never decodes or streams audio itself. It only sends commands to NodeLink through Shoukaku.
- Memory discipline is mandatory: no unbounded caches, no per-message listeners left attached, no growing Maps. Everything keyed by guild must be deleted when the bot leaves voice or the guild is removed.
- Do NOT use yt-dlp, ffmpeg, @discordjs/voice, play-dl or ytdl-core. Audio comes only from NodeLink.
- Do not use emoji anywhere in bot messages, embeds or logs.
- Write code comments and documentation in English. Put every user-visible string in one src/messages.js file so it can be localized later.

=====================================================
1B. BRANDING AND NAMING
=====================================================
The project name is "VanillaSound". Use it consistently:
- package.json: name "vanillasound", with a short description.
- Console log prefix: "[VanillaSound]" for the bot and "[VanillaSound/NodeLink]" for lines coming from the NodeLink process in start.sh.
- Embed footer text: "VanillaSound" on every embed.
- Bot presence/status text: "VanillaSound" plus the prefix hint, for example "VanillaSound | !play".
- README title: "VanillaSound" with a one-paragraph description and a feature list (YouTube, SoundCloud and Spotify, prefix and slash commands, 24/7 mode, NodeLink backend).
- Add an optional BRAND_COLOR variable (hex, with a sensible default) to .env.example and use it for all embeds.
- Put the brand name in one constant (src/config.js) instead of hardcoding it in many files.
- Do not add emoji or ASCII art logos anywhere.

=====================================================
2. AUDIO SOURCES
=====================================================
Supported sources: YouTube (default), SoundCloud, Spotify.

- Detect links automatically:
  - youtube.com, youtu.be, music.youtube.com (single video and playlist)
  - soundcloud.com (track, set/playlist)
  - open.spotify.com (track, album, playlist)
- If the input is not a URL, search with the default source (YouTube) using the search prefix the NodeLink docs specify.
- The play command accepts an optional source switch: "play yt <query>", "play sc <query>", "play sp <query>".
- Spotify album and playlist links must expand into many tracks. Cap at 50 tracks per request to protect RAM, and tell the user how many were added and how many were skipped because of the cap.
- IMPORTANT: Do not guess NodeLink's source names, search prefixes or config keys. Consult the official NodeLink documentation (nodelink.js.org), its API.md and config.default.js, and use exactly what they define. If something is ambiguous or cannot be verified, say so explicitly in a "Verification needed" section at the end of your answer instead of inventing it.
- Explain in the setup guide how to enable the Spotify and SoundCloud sources in NodeLink's config.js, and, if Spotify needs a clientId and clientSecret, how to create them in the Spotify Developer Dashboard and where to place them.

=====================================================
3. COMMANDS
=====================================================
Every command must work BOTH as a prefix command and as a slash command, sharing a single handler so the logic is never duplicated. Each command file exports: name, aliases, description, slash options definition, and one execute(ctx) function that works with a unified context object (ctx.guild, ctx.member, ctx.channel, ctx.args, ctx.reply(), ctx.isSlash, ctx.client).

Commands:
- play <query|url> [source switch]: resolve, join the user's voice channel if not connected, enqueue, start playback if idle. Reply with the track title and queue position, or the count of tracks for playlists.
- skip: skip the current track.
- stop: stop playback and clear the queue, but keep the voice connection.
- pause and resume.
- queue [page]: paginated, 10 tracks per page, with total duration. Use embed buttons for previous/next page, with a 60 second collector timeout that then disables the buttons.
- nowplaying: embed with title, author, source name (YouTube, SoundCloud or Spotify), a text progress bar, elapsed and total time, requester, loop mode, and whether 24/7 mode is on.
- volume <0-100>: set volume via the player. Reply with the new value. Default volume is configurable through .env.
- loop <off|track|queue>
- shuffle: shuffle the upcoming tracks only, not the current one.
- remove <position>: remove a track from the upcoming queue.
- seek <mm:ss>: include it only if NodeLink supports it according to its docs.
- leave: disconnect and fully clean the guild state. In a 24/7 guild this also turns 24/7 mode off for that guild, and the reply must say so.
- 247 [on|off|status]: described in section 4B.

Slash command registration:
- Register on startup. If GUILD_ID is set in .env, register as guild commands (instant updates), otherwise as global commands.
- The play slash command has an autocomplete option that returns up to 5 search suggestions (title and author, truncated to Discord's 100 character limit). Autocomplete must answer within 3 seconds and must fail silently (empty list) on any error.

Prefix commands:
- Prefix is configured by PREFIX in .env, default "!".
- Require the MessageContent intent and mention in the docs how to enable it in the Discord Developer Portal.
- Ignore bots and DMs.

=====================================================
4. BEHAVIOR REQUIREMENTS
=====================================================
Queue and state
- One Queue object per guild stored in a Map keyed by guildId. The Queue class holds: current track, upcoming tracks array, loop mode, volume, text channel for announcements, requester per track, idle timer handle, 24/7 flag, and a reference to the Shoukaku player.
- When a track ends normally, play the next one. Respect loop modes: off, track (repeat current), queue (push finished track to the end).
- Do not announce "now playing" more than once per track, and delete or edit the previous announcement to avoid chat spam.

Voice rules
- Control commands (skip, stop, pause, resume, volume, loop, shuffle, remove, leave) require the user to be in the same voice channel as the bot. play requires the user to be in any voice channel, and if the bot is already in a different channel in that guild, refuse with a clear message.
- Check that the bot has Connect and Speak permission in the target channel before joining, and report clearly if it does not.
- Join with self-deafen enabled to save bandwidth.
- Auto-leave (guilds WITHOUT 24/7 mode only): disconnect and clean state IDLE_LEAVE_SECONDS (default 120) after the queue finishes, and the same duration after the voice channel contains no human members. Cancel the timer when someone joins or a track is added. Use voiceStateUpdate for detection.
- If the bot is moved to another channel or disconnected by a moderator, handle it without throwing (see 4B for 24/7 guilds).

Player events
- Handle end, closed, exception, stuck and update. NodeLink has NO stuck-event concept, and its track-start event fires when audio actually begins sending to Discord, not when the play request is accepted. Verify the exact event names and payloads in the NodeLink docs and Shoukaku v4 typings, and do not depend on a stuck event for recovery.
- On exception, skip to the next track, tell the text channel which track failed and the short reason, and never crash.
- Ignore end events with reason "replaced" or "stopped" when they were caused by our own skip or stop calls, so the queue does not advance twice.

Node resilience
- Handle Shoukaku node events: ready, error, close, disconnect, reconnect. Configure reconnection (reconnectTries and reconnectInterval) sensibly.
- If the node is unavailable when a command needs it, reply with a clear message ("The audio server is not available, try again shortly") instead of throwing.
- Wrap every command execution in try/catch. A single failing command must never crash the process. Add process-level handlers for unhandledRejection and uncaughtException that log and keep running, except for fatal startup errors.
- Gracefully handle SIGTERM and SIGINT: destroy players, disconnect from voice, close the Discord client, then exit. On shutdown, do NOT clear the 24/7 state file.

Performance on the given hardware
- Use only the intents actually needed: Guilds, GuildVoiceStates, GuildMessages, MessageContent.
- Set discord.js cache limits: disable or minimize caches for messages, presences, reactions, users and members that are not needed (use makeCache / sweepers). Keep the memory footprint of the bot process under about 150 MB idle.
- Do not hold search results in memory beyond the request that needs them.
- Store only compact track data in queues (encoded string, title, author, uri, length, artwork URL, source name, requester id), not whole raw API responses.

=====================================================
4B. 24/7 MODE
=====================================================
Goal: in a guild where 24/7 mode is on, the bot stays in its voice channel permanently, survives restarts of the bot, of NodeLink and of the whole container, and never leaves because of silence or an empty channel.

Command: 247 [on|off|status]
- "247 on" (or "247" with no argument, which toggles): the user must be in a voice channel. Save that voice channel and the current text channel for this guild, join if not already connected, and confirm.
- "247 off": clear the setting. The bot then follows the normal auto-leave rules again, and the idle timer starts if the queue is empty.
- "247 status": show whether it is on, which voice channel, and whether the bot is currently connected.
- Only members with the Manage Server permission, or the user ID in OWNER_ID from .env, may use it. Other users get a short permission message.

Persistence
- Store 24/7 state in data/247.json as { "<guildId>": { "voiceChannelId": "...", "textChannelId": "..." } }. Create the data folder and file automatically if missing.
- Write atomically (write to a temp file in the same folder, then rename) and serialize writes so two commands cannot corrupt the file. If the file is corrupt on startup, back it up as 247.json.bak, start with an empty state and log a warning.
- Keep the file tiny: only IDs, never track data.

Startup and recovery
- On startup, after both the Discord client is ready AND the NodeLink node is connected, rejoin every saved guild/voice channel. Rejoin sequentially with a short delay between guilds (for example 1 second) to avoid rate limits and CPU spikes.
- If a saved channel no longer exists, or the bot lacks permission, or the guild is gone, remove that entry from the file, log it, and try to notify the saved text channel if it still exists.
- If NodeLink reconnects after a drop, re-establish players for all 24/7 guilds and resume the current queue if there was one.
- Run a health check every 60 seconds: for each 24/7 guild, verify that the bot is connected to the saved voice channel and a player exists. If not, rejoin with exponential backoff (5s, 10s, 20s, 40s, 60s) for up to 5 consecutive attempts, then wait for the next health check cycle. Log each attempt briefly.
- If the bot is moved by a moderator to another voice channel, follow the move: update the saved voiceChannelId and keep staying there. If the bot is disconnected from voice by a moderator, rejoin to the saved channel using the backoff above.
- If the voice channel is deleted, turn 24/7 off for that guild, clean the entry, and notify the text channel.

Behavior while 24/7 is on
- Never start an idle or empty-channel leave timer for that guild. Stay connected silently when the queue is empty.
- Optional fallback playlist: if FALLBACK_PLAYLIST_URL is set in .env, then whenever the queue becomes empty in a 24/7 guild, load that playlist (apply the 50 track cap) and play it, so the bot is never silent. Re-shuffle it each time it restarts. If the variable is not set, stay silent.
- stop clears the queue but keeps the connection. leave turns 24/7 off and disconnects.
- Resolve the "which text channel to announce in" question like this: use the channel where the last command was run, falling back to the saved textChannelId.

Process-level 24/7
- start.sh must keep both processes alive forever: restart NodeLink and the bot independently if either exits, with a short backoff (for example 3 seconds, doubling up to 30 seconds, reset after 5 minutes of stable running). Log each restart with a timestamp.
- The bot must be safe to restart at any moment without losing the 24/7 configuration.
- Explain how to enable the Pterodactyl auto-restart-on-crash option if the panel offers it.

=====================================================
5. PROJECT STRUCTURE
=====================================================
Provide every file in full, in this layout:

- package.json (name "vanillasound", type: module, scripts: start, start:all, and dependencies with sensible version ranges: discord.js, shoukaku, dotenv)
- .env.example with: TOKEN, CLIENT_ID, GUILD_ID (optional), PREFIX, OWNER_ID, NODELINK_URL (default 127.0.0.1:2333), NODELINK_PASSWORD, NODELINK_SECURE (false), DEFAULT_VOLUME, IDLE_LEAVE_SECONDS (default 120), FALLBACK_PLAYLIST_URL (optional), BRAND_COLOR (optional)
- index.js: client creation, Shoukaku setup, event loading, command loading, slash registration, 24/7 restore, graceful shutdown
- src/config.js: brand name constant, reads and validates env vars and fails fast with a clear message if TOKEN or the NodeLink password is missing
- src/messages.js: all user-facing strings
- src/music/queue.js: Queue class
- src/music/manager.js: Map of queues, get/create/destroy helpers, idle timers
- src/music/resolver.js: URL detection, source selection, search, playlist expansion with the 50 track cap, normalization of NodeLink load results (track, playlist, search, empty, error)
- src/music/stay247.js: 24/7 store (load, save atomically, get, set, remove), restore on startup, health check loop, rejoin with backoff
- src/utils/format.js: time formatting, progress bar, truncation
- src/utils/embeds.js: embed builders
- src/utils/context.js: unified context object for prefix and slash commands
- src/events/ready.js, messageCreate.js, interactionCreate.js (commands, autocomplete and buttons), voiceStateUpdate.js, shoukaku.js (node events), guildDelete.js (clean queue and 24/7 entry)
- src/commands/play.js, skip.js, stop.js, pause.js, resume.js, queue.js, nowplaying.js, volume.js, loop.js, shuffle.js, remove.js, leave.js, 247.js (and seek.js only if supported)
- data/.gitkeep
- README.md titled "VanillaSound"
- start.sh: starts NodeLink first, waits until port 2333 accepts connections, then starts the bot, with the independent restart supervision described in section 4B. Use the memory flags: NodeLink with --max-old-space-size=512 and the bot with --max-old-space-size=384.

=====================================================
6. SETUP GUIDE (write it as a numbered README section)
=====================================================
1. Verify the Node version with node -v (must be 22 or higher) and what to do if the egg's version is lower (change the Node version in the Pterodactyl startup tab).
2. Install NodeLink: git clone https://github.com/PerformanC/NodeLink.git, cd NodeLink, npm install, cp config.default.js config.js.
3. Edit NodeLink's config.js: set the server password and port 2333, host 127.0.0.1, enable only the sources actually used (YouTube, SoundCloud, Spotify), and add Spotify credentials if required.
4. If npm install fails on native packages such as node-libsamplerate or @flat/lame, explain how to remove them from package.json and disable nativePlayback in config.js, and what trade-off that has.
5. Install and configure the bot: npm install, copy .env.example to .env, fill in the values.
6. Create the Discord application: enable the MessageContent privileged intent, invite URL with scopes bot and applications.commands and permissions View Channels, Send Messages, Embed Links, Connect, Speak.
7. How to run both processes in one egg with start.sh, and what to put in the Pterodactyl startup command field.
8. How to turn on 24/7 mode with the 247 command, how the state file works, and how to test recovery (restart the bot, restart NodeLink, restart the container) and what the expected log lines are.
9. If YouTube returns 403 or playback fails with a sign-in error, explain the workaround described in NodeLink's config.js (logging in with a Google/YouTube account), and advise using a throwaway account rather than a personal one.
10. How to monitor RAM and CPU in the panel, what healthy numbers look like for this hardware, and how to spot a memory leak (steady growth that never drops after players are destroyed).
11. Troubleshooting table: node not connecting, bot joins but no sound, slash commands not appearing, MessageContent error, repeated 403s, high RAM, 24/7 bot not rejoining after restart.

=====================================================
7. CODE QUALITY RULES
=====================================================
- Clear separation of concerns, small functions, JSDoc on exported functions.
- No global mutable state except the guild queue Map in manager.js and the 24/7 store in stay247.js.
- Defensive input validation (volume range, position numbers, empty queries, URL length).
- Every user-facing error is a short, plain sentence that tells the user what to do next.
- Consistent error handling: a single helper that logs details to the console and returns a friendly message to the user.
- No secrets in code or logs. Never print the token or passwords.
- Include comments only where the reason is not obvious.

=====================================================
8. OUTPUT FORMAT
=====================================================
1. A short architecture summary (maximum 10 lines).
2. Every file, each in its own fenced code block, with the file path as a heading above it.
3. The README / setup guide from section 6.
4. A "Verification needed" section listing anything about NodeLink config keys, source names, Spotify requirements, player event names or Shoukaku v4 API details that you could not confirm from official documentation, so that I can check it myself.
5. A short list of optional next steps (for example a per-guild DJ role or saved playlists), without implementing them.