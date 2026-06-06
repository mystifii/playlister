import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../logger.js";

/** Per-playlist snapshot of which track ids we've already seen. */
export interface PlaylistState {
  name: string;
  url: string;
  trackIds: string[];
  trackCount: number;
  /** False until the first successful poll, so we don't notify for a backlog. */
  initialized: boolean;
  lastChecked?: string;
  /** Set when the most recent poll failed; cleared on the next success. */
  lastError?: string;
  lastErrorAt?: string;
}

/**
 * Where a notification is delivered: either a Discord webhook URL, or a
 * channel/thread the bot posts to (a thread is just a channel with its own id).
 */
export type DestinationType = "webhook" | "channel";
export interface Destination {
  type: DestinationType;
  /** Set when type === "webhook". */
  webhookUrl?: string;
  /** Set when type === "channel" — a channel or thread id. */
  channelId?: string;
}

export interface Settings {
  /** Discord bot token, required for any "channel" destination. */
  botToken?: string;
  /** Default destination for playlists without their own override. */
  defaultDestination?: Destination;
}

/** A watched playlist: its URL plus an optional per-playlist destination. */
export interface WatchedPlaylist {
  url: string;
  /** When set, notifications for this playlist go here instead of the default. */
  destination?: Destination;
}

export interface AppState {
  /** Configured playlists — the source of truth for what we poll. */
  watched: WatchedPlaylist[];
  /** Snapshots keyed by playlist id. */
  snapshots: Record<string, PlaylistState>;
  /** Runtime-editable settings managed from the web UI. */
  settings: Settings;
}

const EMPTY_STATE: AppState = { watched: [], snapshots: {}, settings: {} };

/**
 * Normalise a watched entry across schema versions:
 *   "url"                              (oldest)
 *   { url, webhookUrl }                (per-playlist webhook)
 *   { url, destination }               (current)
 */
function normaliseWatched(raw: unknown): WatchedPlaylist[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): WatchedPlaylist => {
    if (typeof entry === "string") return { url: entry };
    const e = entry as { url: string; destination?: Destination; webhookUrl?: string };
    if (e.destination) return { url: e.url, destination: e.destination };
    if (e.webhookUrl) {
      return { url: e.url, destination: { type: "webhook", webhookUrl: e.webhookUrl } };
    }
    return { url: e.url };
  });
}

/** Migrate older settings (a bare discordWebhookUrl) to the destination model. */
function normaliseSettings(raw: unknown): Settings {
  const s = (raw ?? {}) as {
    botToken?: string;
    defaultDestination?: Destination;
    discordWebhookUrl?: string;
  };
  return {
    botToken: s.botToken,
    defaultDestination:
      s.defaultDestination ??
      (s.discordWebhookUrl
        ? { type: "webhook", webhookUrl: s.discordWebhookUrl }
        : undefined),
  };
}

export class Store {
  private state: AppState;

  constructor(private readonly file: string) {
    this.state = this.read();
  }

  private read(): AppState {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppState>;
      const state: AppState = {
        watched: normaliseWatched(parsed.watched),
        snapshots: parsed.snapshots ?? {},
        settings: normaliseSettings(parsed.settings),
      };
      logger.info(
        `Loaded state from ${this.file} (${state.watched.length} playlist(s), ` +
          `bot token ${state.settings.botToken ? "set" : "unset"}, ` +
          `default destination ${state.settings.defaultDestination ? "set" : "unset"}).`,
      );
      return state;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info(
          `No existing state at ${this.file} — starting fresh. If you expected ` +
            `saved playlists here, check that this path is on a persistent volume.`,
        );
        return structuredClone(EMPTY_STATE);
      }
      throw err;
    }
  }

  /** Atomic write (temp file + rename) so a crash can't corrupt state. */
  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(tmp, this.file);
  }

  // ---- watched playlist list ----

  getWatched(): WatchedPlaylist[] {
    return this.state.watched.map((w) => ({ ...w }));
  }

  isWatched(url: string): boolean {
    return this.state.watched.some((w) => w.url === url);
  }

  /** Resolve the destination for a playlist URL (its override, else default). */
  effectiveDestination(url: string): Destination | undefined {
    const entry = this.state.watched.find((w) => w.url === url);
    return entry?.destination ?? this.state.settings.defaultDestination;
  }

  /** Populate the watched list from a seed, only if it's currently empty. */
  seedWatched(urls: string[]): void {
    if (this.state.watched.length > 0 || urls.length === 0) return;
    this.state.watched = [...new Set(urls)].map((url) => ({ url }));
    this.write();
    logger.info(`Seeded ${this.state.watched.length} playlist(s) from config.`);
  }

  /** Returns false if the URL was already watched. */
  addWatched(url: string, destination?: Destination): boolean {
    if (this.isWatched(url)) return false;
    this.state.watched.push({ url, destination });
    this.write();
    return true;
  }

  /** Set or clear (pass undefined) a playlist's per-playlist destination. */
  setPlaylistDestination(url: string, destination: Destination | undefined): boolean {
    const entry = this.state.watched.find((w) => w.url === url);
    if (!entry) return false;
    entry.destination = destination;
    this.write();
    return true;
  }

  /** Remove a playlist by its id: drops it from the watch list and snapshots. */
  removeById(id: string): boolean {
    const snap = this.state.snapshots[id];
    const before = this.state.watched.length;
    if (snap) {
      this.state.watched = this.state.watched.filter((w) => w.url !== snap.url);
    }
    delete this.state.snapshots[id];
    const changed =
      this.state.watched.length !== before || snap !== undefined;
    if (changed) this.write();
    return changed;
  }

  /** Remove a playlist by its URL (used when it isn't snapshotted yet). */
  removeByUrl(url: string): boolean {
    const before = this.state.watched.length;
    this.state.watched = this.state.watched.filter((w) => w.url !== url);
    const changed = this.state.watched.length !== before;
    if (changed) this.write();
    return changed;
  }

  // ---- settings ----

  getBotToken(): string | undefined {
    return this.state.settings.botToken;
  }

  setBotToken(token: string | undefined): void {
    this.state.settings.botToken = token || undefined;
    this.write();
  }

  /** Populate the bot token from a seed, only if one isn't already set. */
  seedBotToken(token: string | undefined): void {
    if (this.state.settings.botToken || !token) return;
    this.state.settings.botToken = token;
    this.write();
    logger.info("Seeded Discord bot token from config.");
  }

  getDefaultDestination(): Destination | undefined {
    return this.state.settings.defaultDestination;
  }

  setDefaultDestination(destination: Destination | undefined): void {
    this.state.settings.defaultDestination = destination;
    this.write();
  }

  /** Seed the default destination from a webhook URL, only if none is set. */
  seedDefaultWebhook(url: string | undefined): void {
    if (this.state.settings.defaultDestination || !url) return;
    this.state.settings.defaultDestination = { type: "webhook", webhookUrl: url };
    this.write();
    logger.info("Seeded default Discord webhook from config.");
  }

  // ---- snapshots ----

  getSnapshot(id: string): PlaylistState | undefined {
    return this.state.snapshots[id];
  }

  listSnapshots(): Array<PlaylistState & { id: string }> {
    return Object.entries(this.state.snapshots).map(([id, s]) => ({
      id,
      ...s,
    }));
  }

  setSnapshot(id: string, snapshot: PlaylistState): void {
    this.state.snapshots[id] = snapshot;
    this.write();
  }

  /**
   * Record that a poll failed, against the snapshot matching the URL. This keeps
   * the stale `lastChecked` intact (so it's visibly lagging) and surfaces *why*.
   * Returns false if no snapshot exists yet for that URL.
   */
  recordPollError(url: string, message: string): boolean {
    const entry = Object.values(this.state.snapshots).find((s) => s.url === url);
    if (!entry) return false;
    entry.lastError = message;
    entry.lastErrorAt = new Date().toISOString();
    this.write();
    return true;
  }
}
