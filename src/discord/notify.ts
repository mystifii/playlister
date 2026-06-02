import { logger } from "../logger.js";
import type { Track } from "../apple/public-client.js";

const APPLE_RED = 0xfa243c;

interface AddedTrack {
  playlistName: string;
  playlistUrl?: string;
  track: Track;
}

/**
 * Post one Discord embed per newly added track. We send them individually so
 * each shows its own artwork and link.
 */
export async function notifyTracksAdded(
  webhookUrl: string,
  added: AddedTrack[],
): Promise<void> {
  for (const item of added) {
    await sendEmbed(webhookUrl, item);
  }
}

async function sendEmbed(webhookUrl: string, item: AddedTrack): Promise<void> {
  const { track, playlistName, playlistUrl } = item;
  const embed = {
    author: { name: "Apple Music" },
    title: track.name,
    url: track.url,
    description: track.albumName
      ? `**${track.artistName}** · ${track.albumName}`
      : `**${track.artistName}**`,
    color: APPLE_RED,
    thumbnail: track.artworkUrl ? { url: track.artworkUrl } : undefined,
    footer: {
      text: `Added to ${playlistName}`,
    },
    timestamp: new Date().toISOString(),
    fields: playlistUrl
      ? [{ name: "Playlist", value: `[${playlistName}](${playlistUrl})` }]
      : undefined,
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (res.status === 429) {
    // Respect Discord rate limiting and retry once.
    const retryAfter = Number(res.headers.get("retry-after") ?? "1");
    logger.warn(`Discord rate limited; retrying in ${retryAfter}s.`);
    await sleep(retryAfter * 1000);
    return sendEmbed(webhookUrl, item);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed (${res.status}): ${body}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
