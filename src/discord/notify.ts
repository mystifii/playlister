import { logger } from "../logger.js";
import type { Track } from "../apple/public-client.js";
import type { Destination } from "../store/state.js";

const APPLE_RED = 0xfa243c;
const DISCORD_API = "https://discord.com/api/v10";

interface AddedTrack {
  playlistName: string;
  playlistUrl?: string;
  track: Track;
}

/**
 * Post one Discord embed per newly added track to the given destination
 * (a webhook URL, or a channel/thread via the bot). Sent individually so each
 * shows its own artwork and link.
 */
export async function notifyTracksAdded(
  destination: Destination,
  botToken: string | undefined,
  added: AddedTrack[],
): Promise<void> {
  for (const item of added) {
    await send(destination, botToken, buildEmbed(item));
  }
}

function buildEmbed(item: AddedTrack): Record<string, unknown> {
  const { track, playlistName, playlistUrl } = item;
  return {
    author: { name: "Apple Music" },
    title: track.name,
    url: track.url,
    description: track.albumName
      ? `**${track.artistName}** · ${track.albumName}`
      : `**${track.artistName}**`,
    color: APPLE_RED,
    thumbnail: track.artworkUrl ? { url: track.artworkUrl } : undefined,
    footer: { text: `Added to ${playlistName}` },
    timestamp: new Date().toISOString(),
    fields: playlistUrl
      ? [{ name: "Playlist", value: `[${playlistName}](${playlistUrl})` }]
      : undefined,
  };
}

async function send(
  destination: Destination,
  botToken: string | undefined,
  embed: Record<string, unknown>,
): Promise<void> {
  if (destination.type === "webhook") {
    if (!destination.webhookUrl) throw new Error("Webhook destination has no URL.");
    return post(destination.webhookUrl, { "Content-Type": "application/json" }, embed, "webhook");
  }

  // type === "channel": post as the bot to the channel/thread id.
  if (!destination.channelId) throw new Error("Channel destination has no id.");
  if (!botToken) {
    throw new Error(
      "A channel/thread destination needs a Discord bot token — set one in the web UI.",
    );
  }
  const url = `${DISCORD_API}/channels/${destination.channelId}/messages`;
  return post(
    url,
    { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
    embed,
    "bot channel",
  );
}

async function post(
  url: string,
  headers: Record<string, string>,
  embed: Record<string, unknown>,
  label: string,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (res.status === 429) {
    // Respect Discord rate limiting and retry once.
    const retryAfter = Number(res.headers.get("retry-after") ?? "1");
    logger.warn(`Discord rate limited; retrying in ${retryAfter}s.`);
    await sleep(retryAfter * 1000);
    return post(url, headers, embed, label);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord ${label} post failed (${res.status}): ${body}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
