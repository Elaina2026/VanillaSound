import config from '../config.js';
import { onNodeDrop, onNodeReady } from '../music/stay247.js';

let fallbackReconnectTimer = null;

/**
 * Clears any scheduled fallback reconnect timer.
 */
export function clearShoukakuTimers() {
  if (fallbackReconnectTimer) {
    clearTimeout(fallbackReconnectTimer);
    fallbackReconnectTimer = null;
  }
}

/**
 * Registers Shoukaku node lifecycle handlers for resilience and 24/7 recovery.
 * @param {import('discord.js').Client} client
 * @param {import('shoukaku').Shoukaku} shoukaku
 */
export function registerShoukakuEvents(client, shoukaku) {
  shoukaku.on('ready', (name, lavalinkResume, libraryResume) => {
    clearShoukakuTimers();
    console.log(
      `[${config.brandName}] NodeLink node "${name}" ready (lavalinkResume=${lavalinkResume}, libraryResume=${libraryResume}).`
    );
    onNodeReady(client);
  });

  shoukaku.on('error', (name, error) => {
    console.error(
      `[${config.brandName}] NodeLink node "${name}" error:`,
      error instanceof Error ? error.message : String(error)
    );
  });

  shoukaku.on('close', (name, code, reason) => {
    console.warn(
      `[${config.brandName}] NodeLink node "${name}" closed (code=${code}, reason=${reason || 'none'}).`
    );
    onNodeDrop();
  });

  shoukaku.on('reconnecting', (name, reconnectsLeft, reconnectInterval) => {
    console.log(
      `[${config.brandName}] NodeLink node "${name}" reconnecting in ${reconnectInterval}s (${reconnectsLeft} tries left).`
    );
    onNodeDrop();
  });

  shoukaku.on('disconnect', (name, count) => {
    console.warn(
      `[${config.brandName}] NodeLink node "${name}" disconnected (affected players=${count}).`
    );
    onNodeDrop();

    // If Shoukaku exhausted reconnectTries, keep retrying periodically so 24/7 mode recovers.
    if (!fallbackReconnectTimer) {
      fallbackReconnectTimer = setTimeout(() => {
        fallbackReconnectTimer = null;
        const node = shoukaku.nodes.get(name);
        if (node && node.state === 3 && shoukaku.id) {
          console.log(`[${config.brandName}] Attempting fallback reconnect to NodeLink "${name}".`);
          node.connect().catch(() => {});
        }
      }, 15_000);
    }
  });
}
