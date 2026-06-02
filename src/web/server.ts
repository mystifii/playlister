import express from "express";
import type { Server } from "node:http";
import { Store } from "../store/state.js";
import { Watcher } from "../watcher.js";
import { parsePlaylistUrl } from "../apple/public-client.js";
import { logger } from "../logger.js";
import { PAGE } from "./page.js";

/**
 * Lightweight management UI: list watched playlists and add/remove them.
 * Runs in the same process as the poller and shares its Store + Watcher.
 */
export function startWebServer(
  store: Store,
  watcher: Watcher,
  port: number,
): Server {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.type("html").send(PAGE);
  });

  // List watched playlists, joining the configured URLs with their snapshots.
  app.get("/api/playlists", (_req, res) => {
    const snapshots = new Map(store.listSnapshots().map((s) => [s.url, s]));
    const playlists = store.getWatched().map((url) => {
      const snap = snapshots.get(url);
      return {
        url,
        id: snap?.id ?? null,
        name: snap?.name ?? null,
        trackCount: snap?.trackCount ?? null,
        lastChecked: snap?.lastChecked ?? null,
      };
    });
    res.json({ playlists });
  });

  // Add a playlist: validate the URL, baseline it immediately for instant
  // feedback (name + track count), then persist it to the watch list.
  app.post("/api/playlists", async (req, res) => {
    const url = String(req.body?.url ?? "").trim();
    if (!url) {
      return res.status(400).json({ error: "A playlist URL is required." });
    }
    try {
      parsePlaylistUrl(url); // throws on a malformed link
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
    if (store.getWatched().includes(url)) {
      return res.status(409).json({ error: "That playlist is already watched." });
    }

    try {
      const info = await watcher.baseline(url);
      store.addWatched(url);
      logger.info(`Added playlist via UI: "${info.name}" (${url})`);
      return res.status(201).json({ playlist: { url, ...info } });
    } catch (err) {
      // Don't add an unreachable playlist to the watch list.
      return res.status(502).json({
        error: `Could not load that playlist: ${(err as Error).message}`,
      });
    }
  });

  // Remove a playlist by id.
  app.delete("/api/playlists/:id", (req, res) => {
    const removed = store.removeById(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found." });
    logger.info(`Removed playlist via UI: ${req.params.id}`);
    res.json({ ok: true });
  });

  // Remove by URL too (covers playlists that failed to baseline).
  app.delete("/api/playlists", (req, res) => {
    const url = String(req.body?.url ?? "").trim();
    const removed = url && store.removeByUrl(url);
    if (!removed) return res.status(404).json({ error: "Not found." });
    res.json({ ok: true });
  });

  const server = app.listen(port, () => {
    logger.info(`Web UI listening on http://localhost:${port}`);
  });
  return server;
}
