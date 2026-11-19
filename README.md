![VanillaSound](./Wordmark%20on%20light@1x.png)

# VanillaSound

VanillaSound is a lightweight, production-ready Discord music bot built for private servers on constrained Node.js hosting, using `discord.js` v14, `shoukaku` v4, and a local NodeLink audio server (`PerformanC/NodeLink`) with persistent 24/7 voice support.

## Features

- **Audio sources:** YouTube (default), SoundCloud, and Spotify (tracks, albums, and playlists, with a 50-track per-request cap to protect RAM).
- **Prefix and slash commands:** Every command shares a single handler and works with both prefix commands (default `!`) and slash commands (including live search autocomplete for `/play`).
- **24/7 persistent mode:** Saves active 24/7 voice channels to `data/247.json`, survives bot/NodeLink/container restarts, runs a 60-second health check with exponential backoff, and supports an optional fallback playlist.
- **NodeLink backend:** Audio decoding, resampling, and voice packet transmission run in NodeLink on `127.0.0.1:2333`, keeping the Discord bot process lean and free of FFmpeg, Python, or Java.

## Commands

| Command | Aliases | Description |
| --- | --- | --- |
| `play <query or url>` / `play <yt\|sc\|sp> <query>` | `p` | Play or queue a track or playlist (up to 50 tracks per playlist). |
| `skip` | `s`, `next` | Skip the current track. |
| `stop` | - | Stop playback and clear the queue while staying in voice. |
| `pause` | - | Pause playback. |
| `resume` | `unpause` | Resume paused playback. |
| `queue [page]` | `q` | View the paginated queue (10 tracks per page) with 60s navigation buttons. |
| `nowplaying` | `np` | Show current track details, progress bar, requester, loop mode, and 24/7 status. |
| `volume [0-100]` | `vol` | Show or set the player volume. |
| `loop [off\|track\|queue]` | `repeat` | Show or set the loop mode. |
| `shuffle` | `sh` | Shuffle upcoming tracks without affecting the current track. |
| `remove <position>` | `rm` | Remove an upcoming track by its 1-based queue position. |
| `seek <mm:ss>` | - | Seek to a timestamp (for example `1:30` or `90`). |
| `leave` | `dc`, `disconnect` | Disconnect, clear the queue, and turn 24/7 mode off if enabled. |
| `247 [on\|off\|status]` | `stay`, `stay247` | Manage persistent 24/7 voice mode (requires Manage Server or `OWNER_ID`). |

## Setup Guide

### 1. Verify the Node.js Version

Run:

```bash
node -v
```

NodeLink and VanillaSound require **Node.js v22 or higher** (NodeLink v3+ specifies `>=22.22.2`). If your Pterodactyl egg shows an older version:

1. Open your server in the Pterodactyl panel and go to the **Startup** tab.
2. Locate the **Node.js Version** (or **Docker Image**) selector.
3. Choose Node 22 (or newer, such as Node 22 / Node 24).
4. Reinstall or restart the server and run `node -v` again to confirm.

### 2. Install NodeLink

Inside your container working directory (for example `/home/container`):

```bash
git clone https://github.com/PerformanC/NodeLink.git
cd NodeLink
npm install
```

Create your configuration file from the template:

- On **NodeLink v3 / `dev`** (current default branch):
  ```bash
  cp config.default.ts config.ts
  ```
  (If you built `dist/` or are using compiled output, `dist/config.default.js` is also present.)
- On **NodeLink v2 legacy** (`v2-legacy` branch):
  ```bash
  cp config.default.js config.js
  ```

### 3. Configure NodeLink (`127.0.0.1:2333`, Sources, and Spotify)

Open `config.ts` (or `config.js` on legacy NodeLink) and update the following sections:

1. **Server address, port, and password:**
   ```js
   server: {
     host: '127.0.0.1',
     port: 2333,
     password: 'choose-a-strong-password-here'
   }
   ```
   Make sure `password` matches `NODELINK_PASSWORD` in VanillaSound's `.env`.

2. **Enable only the sources you use (`youtube`, `soundcloud`, `spotify`):**
   In `sources`, keep `youtube`, `soundcloud`, and `spotify` set to `enabled: true`, and set unused sources (such as `applemusic`, `deezer`, `tidal`, `vkmusic`, `jiosaavn`, `gaana`, `yandexmusic`, `eternalbox`, `pipertts`, etc.) to `enabled: false` to save memory and startup probe overhead.

   Example minimal `sources` configuration for NodeLink v3+:
   ```js
   sources: {
     youtube: {
       enabled: true
     },
     soundcloud: {
       enabled: true,
       clientId: ''
     },
     spotify: {
       enabled: true,
       clientId: 'YOUR_SPOTIFY_CLIENT_ID',
       clientSecret: 'YOUR_SPOTIFY_CLIENT_SECRET',
       market: 'US'
     }
   }
   ```
   Also set `search.defaultSource: ['youtube']` (or `['youtube', 'soundcloud']`) so keyword searches default to YouTube.

3. **Create Spotify API credentials (`clientId` and `clientSecret`):**
   Spotify tracks in NodeLink resolve metadata via Spotify and stream audio via a mirror source (such as YouTube or SoundCloud). Adding official Spotify credentials avoids anonymous/public token rate limits:
   1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and sign in.
   2. Click **Create app**.
   3. Enter an app name (for example `VanillaSound`), a short description, and a dummy Redirect URI such as `http://127.0.0.1:8888/callback`.
   4. Check the Web API option and save.
   5. Open **Settings** on your new app and copy the **Client ID** and **Client Secret**.
   6. Paste them into `sources.spotify.clientId` and `sources.spotify.clientSecret` in NodeLink's `config.ts` (or `config.js`).

### 4. Handling Native Package Failures (`node-libsamplerate` / `@flat/lame`)

On Node.js-only Pterodactyl eggs without Python or build compilers (`gcc`/`make`), older NodeLink v2 installations can fail during `npm install` when building native addons such as `node-libsamplerate` or `@flat/lame`.

- **If you are on NodeLink v3+:** Native C++ decoders were replaced with WebAssembly/prebuilt packages (`@alexanderolsen/libsamplerate-js`, `@ecliptia/faad2-wasm`, `@toddynnn/symphonia-decoder`, `@toddynnn/voice-opus`), so `npm install` normally succeeds without compilers.
- **If you are on NodeLink v2 legacy and `npm install` fails on `node-libsamplerate` or `@flat/lame`:**
  1. Open `NodeLink/package.json` and remove the `"node-libsamplerate"` and `"@flat/lame"` lines from `"dependencies"`.
  2. Run `npm install` again.
  3. Open `NodeLink/config.js` and set `options.nativePlayback: false`.
  4. **Trade-off:** Disabling `nativePlayback` switches audio processing/resampling from native C bindings to JavaScript fallbacks, which uses slightly more single-core CPU per active stream in exchange for zero native compilation requirements.

### 5. Install and Configure VanillaSound

Return to the bot directory (if NodeLink is cloned inside `/home/container/NodeLink` and the bot is in `/home/container/VanillaSound` or `/home/container`):

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in your values:

- `TOKEN`: Your Discord bot token.
- `CLIENT_ID`: Your Discord application ID.
- `GUILD_ID`: Optional server ID for instant slash command updates while testing (leave blank for global commands).
- `PREFIX`: Prefix for text commands (default `!`).
- `OWNER_ID`: Your Discord user ID (grants `247` command access even without Manage Server).
- `NODELINK_URL`: `127.0.0.1:2333`.
- `NODELINK_PASSWORD`: Must match `server.password` in NodeLink's config.
- `NODELINK_SECURE`: `false`.
- `DEFAULT_VOLUME`: `50` (0-100).
- `IDLE_LEAVE_SECONDS`: `120` (for non-24/7 servers).
- `FALLBACK_PLAYLIST_URL`: Optional YouTube/SoundCloud/Spotify playlist URL for 24/7 servers when the queue becomes empty.
- `BRAND_COLOR`: Optional hex color for embeds (default `#5865F2`).

### 6. Create the Discord Application and Invite the Bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**, naming it `VanillaSound`.
2. Go to the **Bot** tab, create a bot, and copy its **Token** into `.env` (`TOKEN`).
3. On the **Bot** tab under **Privileged Gateway Intents**, enable **Message Content Intent** (`MessageContent`). Prefix commands like `!play` will not read arguments without this toggle.
4. Go to **OAuth2 -> URL Generator**:
   - **Scopes:** `bot`, `applications.commands`
   - **Bot Permissions:** `View Channels`, `Send Messages`, `Embed Links`, `Connect`, `Speak`
5. Open the generated URL in your browser and invite the bot to your private server.

### 7. Run Both Processes with `start.sh` on Pterodactyl

`start.sh` starts NodeLink first (`--max-old-space-size=512`), waits until `127.0.0.1:2333` accepts TCP connections, and then launches the bot (`--max-old-space-size=384`). Each process is supervised independently and restarts automatically with exponential backoff (`3s`, `6s`, `12s`, `24s`, `30s`, resetting after 5 minutes of uptime).

1. Ensure `start.sh` is executable:
   ```bash
   chmod +x start.sh
   ```
2. By default, `start.sh` looks for NodeLink in `./NodeLink` or `../NodeLink`. If you placed NodeLink elsewhere, set `NODELINK_DIR=/home/container/NodeLink` in your environment or startup variables.
3. In Pterodactyl's **Startup** tab, set the **Startup Command** to:
   ```bash
   bash ./start.sh
   ```
   (Or `npm run start:all` if your egg executes npm scripts.)
4. **Pterodactyl Auto-Restart:** In Pterodactyl, go to **Settings** (or **Startup** depending on your panel theme) and enable **Auto-Restart on Crash** if offered, so the container itself restarts if the supervisor script ever exits unexpectedly.

### 8. Enable and Test 24/7 Mode

1. Join a voice channel in your Discord server and run `/247 on` or `!247 on` (requires **Manage Server** permission or `OWNER_ID`).
2. VanillaSound writes `{ "<guildId>": { "voiceChannelId": "...", "textChannelId": "..." } }` atomically to `data/247.json`.
3. **Testing recovery:**
   - **Test bot restart:** Kill only the bot node PID or trigger a restart. Expected logs:
     - `[VanillaSound] ... Bot exited with code ... Restarting in 3s...`
     - `[VanillaSound] Connected to Discord as ...`
     - `[VanillaSound] NodeLink node "nodelink-local" ready ...`
     - `[VanillaSound] Restoring 1 24/7 voice connection(s).`
     - `[VanillaSound] Restored 24/7 connection for guild <id>.`
   - **Test NodeLink restart:** Kill only the NodeLink PID. Expected logs:
     - `[VanillaSound] ... NodeLink exited with code ... Restarting in 3s...`
     - `[VanillaSound] NodeLink node "nodelink-local" reconnecting in 5s...`
     - `[VanillaSound] NodeLink node "nodelink-local" ready ...`
     - `[VanillaSound] NodeLink reconnected. Re-establishing 24/7 players.`
   - **Test container restart:** Restart the entire server from Pterodactyl. Both processes start via `start.sh`, wait for port `2333`, and automatically rejoin the saved voice channel.

### 9. YouTube 403 or Sign-In Errors

If YouTube playback fails with HTTP `403` or `"Sign in to confirm you're not a bot"` / `"Sign in to confirm your age"`:

- **Use a throwaway Google/YouTube account**, never your personal account, because automated requests can trigger account warnings or restrictions.
- **In NodeLink v3+ (`config.ts`):**
  1. Under `sources.youtube`, set `getOAuthToken: true`.
  2. Restart NodeLink and watch the `[VanillaSound/NodeLink]` logs for the Google device login URL and one-time code.
  3. Complete the sign-in in a browser using your throwaway account.
  4. Copy the generated refresh token into `sources.youtube.clients.settings.TV.refreshToken: ['YOUR_REFRESH_TOKEN']` and set `getOAuthToken: false`.
- **In NodeLink v2 legacy (`config.js`):**
  1. Look under `search.sources.youtube.authentication` (and `OAuth` settings if present in your commit) and follow the documented token/TV OAuth fields with a throwaway account.

### 10. Monitoring RAM and CPU

Watch the **Console / Resource Graphs** in Pterodactyl:

- **Healthy idle footprint (1 GB RAM / 1 vCPU container):**
  - VanillaSound bot: ~60-110 MB RSS idle, well below the 150 MB target and 384 MB V8 heap cap.
  - NodeLink: ~90-180 MB RSS idle (varies by enabled sources), capped at 512 MB heap.
  - Combined idle RAM: ~180-300 MB total, leaving comfortable headroom inside 1 GB.
  - CPU: <2% idle; ~5-20% on 1 core during active playback depending on bitrate and source.
- **Spotting a memory leak:**
  - Healthy behavior: RAM rises slightly while a guild is playing or loading a 50-track playlist, then levels off and drops back after `leave` or auto-leave destroys the player.
  - Leak warning sign: RAM climbs continuously across hours or after multiple `play` / `leave` cycles and never drops after players are destroyed. If this happens, inspect whether NodeLink has unused heavy sources enabled or check which process (`bot` vs `NodeLink`) is growing.

### 11. Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| Node not connecting | NodeLink is down, wrong port, or password mismatch | Check `[VanillaSound/NodeLink]` logs, verify `server.host: '127.0.0.1'` and `port: 2333` in NodeLink config, and match `NODELINK_PASSWORD` in `.env`. |
| Bot joins voice but no sound | Outbound UDP blocked or incompatible voice encryption | Check container firewall/UDP access; in NodeLink `config.ts`, verify `playback.audio.encryption` and check `[VanillaSound/NodeLink]` for player exceptions. |
| Slash commands not appearing | Global registration propagation delay or missing `applications.commands` scope | Set `GUILD_ID` in `.env` for instant server updates, and re-invite the bot with both `bot` and `applications.commands` scopes. |
| Prefix commands ignored (`MessageContent` error) | `Message Content Intent` disabled in Discord Developer Portal | Enable **Message Content Intent** under **Bot -> Privileged Gateway Intents** in the Discord Developer Portal and restart the bot. |
| Repeated YouTube 403 errors | YouTube IP throttling or missing cipher/OAuth | Update NodeLink (`git pull`), check `sources.youtube.cipher.url`, or configure YouTube TV OAuth with a throwaway Google account. |
| High RAM usage | Too many NodeLink sources enabled or large heap limits | Disable unused sources in NodeLink config, keep the 50-track playlist cap, and keep `--max-old-space-size=512` (NodeLink) and `384` (bot). |
| 24/7 bot does not rejoin after restart | Channel deleted, missing `Connect`/`Speak` permissions, or corrupt `data/247.json` | Check `[VanillaSound]` startup logs for permission warnings or `247.json.bak`; re-run `247 on` in a valid voice channel. |
