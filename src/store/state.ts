import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../logger.js";

/** Per-playlist snapshot of which track ids we've already seen. */
export interface PlaylistState {
  name: string;
  trackIds: string[];
  /** False until the first successful poll, so we don't notify for a backlog. */
  initialized: boolean;
  lastChecked?: string;
}

export interface AppState {
  playlists: Record<string, PlaylistState>;
}

const EMPTY_STATE: AppState = { playlists: {} };

export class Store {
  private state: AppState;

  constructor(private readonly file: string) {
    this.state = this.read();
  }

  private read(): AppState {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as AppState;
      return { playlists: parsed.playlists ?? {} };
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

  getPlaylist(id: string): PlaylistState | undefined {
    return this.state.playlists[id];
  }

  setPlaylist(id: string, state: PlaylistState): void {
    this.state.playlists[id] = state;
    this.write();
  }
}
