import express from "express";
import type { Server } from "node:http";
import { Store, type Destination } from "../store/state.js";
import { Watcher } from "../watcher.js";
import { parsePlaylistUrl } from "../apple/public-client.js";
import { logger } from "../logger.js";
import { PAGE } from "./page.js";

/**
 * Lightweight management UI: list/add/remove watched playlists and configure
 * Discord delivery (webhook or bot channel/thread, globally and per playlist).
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

  // ---- settings (bot token + default destination) ----

  app.get("/api/settings", (_req, res) => {
    const token = store.getBotToken();
    res.json({
      botTokenSet: Boolean(token),
      botTokenPreview: maskToken(token),
      defaultDestination: destinationView(store.getDefaultDestination()),
    });
  });

  // Set/clear the bot token (needed for any channel/thread destination).
  app.put("/api/settings/bot-token", (req, res) => {
    const raw = req.body?.botToken;
    if (raw === "" || raw === null || raw === undefined) {
      store.setBotToken(undefined);
      logger.info("Discord bot token cleared via UI.");
      return res.json({ botTokenSet: false, botTokenPreview: null });
    }
    const token = String(raw).trim();
    if (!looksLikeBotToken(token)) {
      return res.status(400).json({ error: "That doesn't look like a Discord bot token." });
    }
    store.setBotToken(token);
    logger.info("Discord bot token updated via UI.");
    res.json({ botTokenSet: true, botTokenPreview: maskToken(token) });
  });

  // Set/clear the default destination. Body: { type, value } or empty to clear.
  app.put("/api/settings/default-destination", (req, res) => {
    const built = buildDestinationFromBody(req.body);
    if ("cleared" in built) {
      store.setDefaultDestination(undefined);
      logger.info("Default Discord destination cleared via UI.");
      return res.json({ defaultDestination: null });
    }
    if ("error" in built) return res.status(400).json({ error: built.error });
    store.setDefaultDestination(built.destination);
    logger.info(`Default Discord destination set (${built.destination.type}).`);
    res.json({ defaultDestination: destinationView(built.destination) });
  });

  // ---- playlists ----

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
        lastError: snap?.lastError ?? null,
        lastErrorAt: snap?.lastErrorAt ?? null,
        usesDefault: !w.destination,
        destination: destinationView(w.destination),
      };
    });
    res.json({
      playlists,
      defaultDestination: destinationView(store.getDefaultDestination()),
      botTokenSet: Boolean(store.getBotToken()),
    });
  });

  // Add a playlist: validate the URL (and optional destination), baseline it
  // immediately for instant feedback, then persist it.
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

    let destination: Destination | undefined;
    if (req.body?.destination) {
      const built = buildDestinationFromBody(req.body.destination);
      if ("error" in built) return res.status(400).json({ error: built.error });
      if ("destination" in built) destination = built.destination;
    }

    try {
      const info = await watcher.baseline(url);
      store.addWatched(url, destination);
      logger.info(`Added playlist via UI: "${info.name}" (${url})`);
      return res
        .status(201)
        .json({ playlist: { url, ...info, usesDefault: !destination } });
    } catch (err) {
      // Don't add an unreachable playlist to the watch list.
      return res.status(502).json({
        error: `Could not load that playlist: ${(err as Error).message}`,
      });
    }
  });

  // Set or clear a playlist's per-playlist destination (by id). Empty clears it,
  // falling back to the default destination.
  app.put("/api/playlists/:id/destination", (req, res) => {
    const snap = store.getSnapshot(req.params.id);
    if (!snap) return res.status(404).json({ error: "Not found." });

    const built = buildDestinationFromBody(req.body);
    if ("cleared" in built) {
      store.setPlaylistDestination(snap.url, undefined);
      logger.info(`Cleared destination override for "${snap.name}".`);
      return res.json({ usesDefault: true, destination: null });
    }
    if ("error" in built) return res.status(400).json({ error: built.error });
    store.setPlaylistDestination(snap.url, built.destination);
    logger.info(`Set destination override for "${snap.name}" (${built.destination.type}).`);
    res.json({ usesDefault: false, destination: destinationView(built.destination) });
  });

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

// ---- destination parsing / validation ----

type BuildResult =
  | { destination: Destination }
  | { cleared: true }
  | { error: string };

/**
 * Build a Destination from a request body of the form { type, value }.
 * type "none" / empty value / missing type clears it.
 */
function buildDestinationFromBody(body: unknown): BuildResult {
  const b = (body ?? {}) as { type?: string; value?: unknown };
  const type = (b.type ?? "").toString().trim();
  const value = (b.value ?? "").toString().trim();

  if (!type || type === "none" || (type !== "channel" && value === "")) {
    return { cleared: true };
  }
  if (type === "webhook") {
    if (!isValidWebhook(value)) {
      return { error: "That doesn't look like a Discord webhook URL." };
    }
    return { destination: { type: "webhook", webhookUrl: value } };
  }
  if (type === "channel") {
    const channelId = parseChannelId(value);
    if (!channelId) {
      return {
        error:
          "Enter a numeric channel/thread ID, or paste the channel/thread link.",
      };
    }
    return { destination: { type: "channel", channelId } };
  }
  return { error: `Unknown destination type "${type}".` };
}

const WEBHOOK_RE =
  /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

function isValidWebhook(url: string): boolean {
  return WEBHOOK_RE.test(url);
}

/** Accept a raw snowflake or a Discord channel/thread/message link. */
function parseChannelId(input: string): string | null {
  const link = input.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)/);
  if (link) return link[1];
  if (/^\d{17,20}$/.test(input)) return input;
  return null;
}

/** Lenient bot-token sanity check (no whitespace, plausible length). */
function looksLikeBotToken(token: string): boolean {
  return /^[A-Za-z0-9_.-]{40,}$/.test(token);
}

function destinationView(d: Destination | undefined): unknown {
  if (!d) return null;
  if (d.type === "webhook") {
    return { type: "webhook", webhookPreview: maskWebhook(d.webhookUrl) };
  }
  return { type: "channel", channelId: d.channelId };
}

/** Hide the secret token, e.g. .../webhooks/123456789/••••••••. */
function maskWebhook(url: string | undefined): string | null {
  if (!url) return null;
  const i = url.lastIndexOf("/");
  if (i < 0) return "••••••••";
  return url.slice(0, i + 1) + "••••••••";
}

/** Show only the first few characters of the bot token. */
function maskToken(token: string | undefined): string | null {
  if (!token) return null;
  return token.slice(0, 6) + "••••••••";
}
