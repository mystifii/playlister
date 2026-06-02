import { loadConfig } from "./config.js";
import { Store } from "./store/state.js";
import { Watcher } from "./watcher.js";
import { AppleMusicPublicClient } from "./apple/public-client.js";
import { startWebServer } from "./web/server.js";
import { logger } from "./logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.stateFile);

  // Populate the watch list from PLAYLISTS the first time only; after that the
  // list is managed through the web UI and lives in state.json.
  store.seedWatched(config.seedPlaylistUrls);

  const client = new AppleMusicPublicClient();
  const watcher = new Watcher(config, store, client);

  const server = startWebServer(store, watcher, config.webPort);

  logger.info(
    `Playlister started. Watching ${store.getWatched().length} playlist(s), ` +
      `polling every ${config.pollIntervalSeconds}s.`,
  );

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    logger.info(`Received ${signal}, shutting down.`);
    stopping = true;
    server.close();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stopping) {
    const startedAt = Date.now();
    await watcher.pollAll();

    // Sleep for the remainder of the interval, in short slices so a shutdown
    // signal is honoured promptly.
    const elapsed = Date.now() - startedAt;
    let remaining = config.pollIntervalSeconds * 1000 - elapsed;
    while (remaining > 0 && !stopping) {
      const slice = Math.min(remaining, 1000);
      await sleep(slice);
      remaining -= slice;
    }
  }

  logger.info("Stopped.");
}

main().catch((err) => {
  logger.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
