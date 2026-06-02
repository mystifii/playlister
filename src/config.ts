import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  /** Optional seed, used only to populate settings on first run. */
  seedDiscordWebhookUrl?: string;
  pollIntervalSeconds: number;
  /** Optional seed list, used only to populate state on first run. */
  seedPlaylistUrls: string[];
  stateFile: string;
  webPort: number;
}

function parsePlaylists(): string[] {
  const raw = process.env.PLAYLISTS ?? "";
  return raw
    .split(/[,\n]/)
    .map((u) => u.trim())
    .filter((u) => u !== "");
}

export function loadConfig(): Config {
  return {
    seedDiscordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || undefined,
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? "300"),
    seedPlaylistUrls: parsePlaylists(),
    stateFile: resolve(process.env.STATE_FILE ?? "./data/state.json"),
    webPort: Number(process.env.WEB_PORT ?? "8080"),
  };
}
