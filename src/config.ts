import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  discordWebhookUrl: string;
  pollIntervalSeconds: number;
  /** Public Apple Music share URLs to watch. */
  playlistUrls: string[];
  stateFile: string;
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
  const raw = required("PLAYLISTS");
  const urls = raw
    .split(/[,\n]/)
    .map((u) => u.trim())
    .filter((u) => u !== "");
  if (urls.length === 0) {
    throw new Error("PLAYLISTS must contain at least one Apple Music playlist URL.");
  }
  return urls;
}

export function loadConfig(): Config {
  return {
    discordWebhookUrl: required("DISCORD_WEBHOOK_URL"),
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? "300"),
    playlistUrls: parsePlaylists(),
    stateFile: resolve(process.env.STATE_FILE ?? "./data/state.json"),
  };
}
