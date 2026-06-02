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

  // Populate the watch list and webhook from env the first time only; after
  // that they're managed through the web UI and live in state.json.
  store.seedWatched(config.seedPlaylistUrls);
  store.seedWebhookUrl(config.seedDiscordWebhookUrl);

  const client = new AppleMusicPublicClient();
  const watcher = new Watcher(store, client);

  if (!store.getWebhookUrl()) {
    logger.warn(
      "No Discord webhook set yet — configure one in the web UI to receive notifications.",
    );
  }

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
