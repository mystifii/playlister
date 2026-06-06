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

  // Settings: report whether a webhook is set, with a masked preview (we never
  // send the secret token back to the browser).
  app.get("/api/settings", (_req, res) => {
    const url = store.getWebhookUrl();
    res.json({ webhookSet: Boolean(url), webhookPreview: maskWebhook(url) });
  });

  app.put("/api/settings", (req, res) => {
    const raw = req.body?.discordWebhookUrl;
    // An empty string clears the webhook (disables notifications).
    if (raw === "" || raw === null) {
      store.setWebhookUrl(undefined);
      logger.info("Discord webhook cleared via UI.");
      return res.json({ webhookSet: false, webhookPreview: null });
    }
    const url = String(raw ?? "").trim();
    if (!isValidWebhook(url)) {
      return res.status(400).json({
        error: "That doesn't look like a Discord webhook URL.",
      });
    }
    store.setWebhookUrl(url);
    logger.info("Discord webhook updated via UI.");
    res.json({ webhookSet: true, webhookPreview: maskWebhook(url) });
  });

  // List watched playlists, joining the configured entries with their
  // snapshots. Each reports whether it has its own webhook override (masked).
  app.get("/api/playlists", (_req, res) => {
    const snapshots = new Map(store.listSnapshots().map((s) => [s.url, s]));
    const playlists = store.getWatched().map((w) => {
      const snap = snapshots.get(w.url);
      return {
        url: w.url,
        id: snap?.id ?? null,
        name: snap?.name ?? null,
        trackCount: snap?.trackCount ?? null,
        lastChecked: snap?.lastChecked ?? null,
        customWebhook: Boolean(w.webhookUrl),
        webhookPreview: maskWebhook(w.webhookUrl),
      };
    });
    res.json({ playlists, defaultWebhookSet: Boolean(store.getWebhookUrl()) });
  });

  // Add a playlist: validate the URL (and optional per-playlist webhook),
  // baseline it immediately for instant feedback, then persist it.
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
    if (store.isWatched(url)) {
      return res.status(409).json({ error: "That playlist is already watched." });
    }
    const webhookUrl = String(req.body?.webhookUrl ?? "").trim();
    if (webhookUrl && !isValidWebhook(webhookUrl)) {
      return res
        .status(400)
        .json({ error: "That doesn't look like a Discord webhook URL." });
    }

    try {
      const info = await watcher.baseline(url);
      store.addWatched(url, webhookUrl || undefined);
      logger.info(`Added playlist via UI: "${info.name}" (${url})`);
      return res
        .status(201)
        .json({ playlist: { url, ...info, customWebhook: Boolean(webhookUrl) } });
    } catch (err) {
      // Don't add an unreachable playlist to the watch list.
      return res.status(502).json({
        error: `Could not load that playlist: ${(err as Error).message}`,
      });
    }
  });

  // Set or clear a playlist's per-playlist webhook override (by id).
  // An empty/null value clears it, falling back to the default webhook.
  app.put("/api/playlists/:id/webhook", (req, res) => {
    const snap = store.getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ error: "Not found." });

    const raw = req.body?.webhookUrl;
    if (raw === "" || raw === null || raw === undefined) {
      store.setPlaylistWebhook(snap.url, undefined);
      logger.info(`Cleared webhook override for "${snap.name}".`);
      return res.json({ customWebhook: false, webhookPreview: null });
    }
    const webhookUrl = String(raw).trim();
    if (!isValidWebhook(webhookUrl)) {
      return res
        .status(400)
        .json({ error: "That doesn't look like a Discord webhook URL." });
    }
    store.setPlaylistWebhook(snap.url, webhookUrl);
    logger.info(`Set webhook override for "${snap.name}".`);
    res.json({ customWebhook: true, webhookPreview: maskWebhook(webhookUrl) });
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

const WEBHOOK_RE =
  /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

function isValidWebhook(url: string): boolean {
  return WEBHOOK_RE.test(url);
}

/** Hide the secret token, e.g. .../webhooks/123456789/••••••••. */
function maskWebhook(url: string | undefined): string | null {
  if (!url) return null;
  const i = url.lastIndexOf("/");
  if (i < 0) return "••••••••";
  return url.slice(0, i + 1) + "••••••••";
}
