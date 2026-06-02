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
}

export interface Settings {
  discordWebhookUrl?: string;
}

export interface AppState {
  /** Configured playlist URLs — the source of truth for what we poll. */
  watched: string[];
  /** Snapshots keyed by playlist id. */
  snapshots: Record<string, PlaylistState>;
  /** Runtime-editable settings managed from the web UI. */
  settings: Settings;
}

const EMPTY_STATE: AppState = { watched: [], snapshots: {}, settings: {} };

export class Store {
  private state: AppState;

  constructor(private readonly file: string) {
    this.state = this.read();
  }

  private read(): AppState {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppState>;
      return {
        watched: parsed.watched ?? [],
        snapshots: parsed.snapshots ?? {},
        settings: parsed.settings ?? {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info(`No existing state at ${this.file}; starting fresh.`);
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

  getWatched(): string[] {
    return [...this.state.watched];
  }

  /** Populate the watched list from a seed, only if it's currently empty. */
  seedWatched(urls: string[]): void {
    if (this.state.watched.length > 0 || urls.length === 0) return;
    this.state.watched = [...new Set(urls)];
    this.write();
    logger.info(`Seeded ${this.state.watched.length} playlist(s) from config.`);
  }

  /** Returns false if the URL was already watched. */
  addWatched(url: string): boolean {
    if (this.state.watched.includes(url)) return false;
    this.state.watched.push(url);
    this.write();
    return true;
  }

  /** Remove a playlist by its id: drops it from the watch list and snapshots. */
  removeById(id: string): boolean {
    const snap = this.state.snapshots[id];
    const before = this.state.watched.length;
    if (snap) {
      this.state.watched = this.state.watched.filter((u) => u !== snap.url);
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
    this.state.watched = this.state.watched.filter((u) => u !== url);
    const changed = this.state.watched.length !== before;
    if (changed) this.write();
    return changed;
  }

  // ---- settings ----

  getWebhookUrl(): string | undefined {
    return this.state.settings.discordWebhookUrl;
  }

  setWebhookUrl(url: string | undefined): void {
    this.state.settings.discordWebhookUrl = url || undefined;
    this.write();
  }

  /** Populate the webhook from a seed, only if one isn't already set. */
  seedWebhookUrl(url: string | undefined): void {
    if (this.state.settings.discordWebhookUrl || !url) return;
    this.state.settings.discordWebhookUrl = url;
    this.write();
    logger.info("Seeded Discord webhook from config.");
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
}
