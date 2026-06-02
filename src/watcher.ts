import {
  AppleMusicPublicClient,
  parsePlaylistUrl,
  type Track,
} from "./apple/public-client.js";
import { notifyTracksAdded } from "./discord/notify.js";
import { Store } from "./store/state.js";
import { logger } from "./logger.js";
import type { Config } from "./config.js";

/**
 * Polls every watched playlist once: fetches its current tracks, diffs against
 * the stored snapshot, notifies Discord about anything new, and persists the
 * updated snapshot.
 *
 * The first time a playlist is seen we record its tracks as a baseline WITHOUT
 * notifying, so we don't dump the whole existing playlist into Discord.
 */
export class Watcher {
  private readonly client = new AppleMusicPublicClient();

  constructor(
    private readonly config: Config,
    private readonly store: Store,
  ) {}

  async pollAll(): Promise<void> {
    for (const url of this.config.playlistUrls) {
      try {
        await this.pollOne(url);
      } catch (err) {
        // One bad playlist shouldn't stop the others or kill the loop.
        logger.error(`Failed to poll ${url}: ${(err as Error).message}`);
      }
    }
  }

  private async pollOne(url: string): Promise<void> {
    const ref = parsePlaylistUrl(url);
    const snapshot = await this.client.getPlaylist(ref);
    const currentIds = snapshot.tracks.map((t) => t.id);

    const prev = this.store.getPlaylist(ref.id);

    if (!prev || !prev.initialized) {
      this.store.setPlaylist(ref.id, {
        name: snapshot.name,
        trackIds: currentIds,
        initialized: true,
        lastChecked: new Date().toISOString(),
      });
      logger.info(
        `Baseline established for "${snapshot.name}" (${currentIds.length} tracks). ` +
          `Future additions will be reported.`,
      );
      return;
    }

    const known = new Set(prev.trackIds);
    const newTracks: Track[] = snapshot.tracks.filter((t) => !known.has(t.id));

    if (newTracks.length > 0) {
      logger.info(
        `"${snapshot.name}": ${newTracks.length} new track(s) detected.`,
      );
      await notifyTracksAdded(
        this.config.discordWebhookUrl,
        newTracks.map((track) => ({
          playlistName: snapshot.name,
          playlistUrl: url,
          track,
        })),
      );
    } else {
      logger.debug(`"${snapshot.name}": no changes.`);
    }

    this.store.setPlaylist(ref.id, {
      name: snapshot.name,
      trackIds: currentIds,
      initialized: true,
      lastChecked: new Date().toISOString(),
    });
  }
}
