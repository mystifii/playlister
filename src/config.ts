import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  discordWebhookUrl: string;
  pollIntervalSeconds: number;
  /** Optional seed list, used only to populate state on first run. */
  seedPlaylistUrls: string[];
  stateFile: string;
  webPort: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
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
    discordWebhookUrl: required("DISCORD_WEBHOOK_URL"),
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? "300"),
    seedPlaylistUrls: parsePlaylists(),
    stateFile: resolve(process.env.STATE_FILE ?? "./data/state.json"),
    webPort: Number(process.env.WEB_PORT ?? "8080"),
  };
}
