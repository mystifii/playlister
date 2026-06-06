import {
  AppleMusicPublicClient,
  parsePlaylistUrl,
  type Track,
} from "./apple/public-client.js";
import { notifyTracksAdded } from "./discord/notify.js";
import { Store, type PlaylistState } from "./store/state.js";
import { logger } from "./logger.js";

/**
 * Polls watched playlists: fetches current tracks, diffs against the stored
 * snapshot, notifies Discord about anything new, and persists the snapshot.
 *
 * The first time a playlist is seen we record its tracks as a baseline WITHOUT
 * notifying, so we don't dump the whole existing playlist into Discord.
 */
export class Watcher {
  constructor(
    private readonly store: Store,
    private readonly client: AppleMusicPublicClient,
  ) {}

  async pollAll(): Promise<void> {
    for (const { url } of this.store.getWatched()) {
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
    const prev = this.store.getSnapshot(ref.id);

    if (!prev || !prev.initialized) {
      this.saveSnapshot(ref.id, url, snapshot.name, currentIds);
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
      const destination = this.store.effectiveDestination(url);
      const botToken = this.store.getBotToken();
      if (!destination) {
        logger.warn(
          `No Discord destination configured — skipping ${newTracks.length} ` +
            `notification(s). Set one in the web UI.`,
        );
      } else if (destination.type === "channel" && !botToken) {
        logger.warn(
          `"${snapshot.name}" posts to a channel/thread but no bot token is set ` +
            `— skipping ${newTracks.length} notification(s).`,
        );
      } else {
        await notifyTracksAdded(
          destination,
          botToken,
          newTracks.map((track) => ({
            playlistName: snapshot.name,
            playlistUrl: url,
            track,
          })),
        );
      }
    } else {
      logger.debug(`"${snapshot.name}": no changes.`);
    }

    this.saveSnapshot(ref.id, url, snapshot.name, currentIds);
  }

  /**
   * Fetch a playlist once and record it as a silent baseline. Used when a
   * playlist is added via the web UI so it shows up immediately (and existing
   * tracks don't trigger notifications). Returns the snapshot id + name.
   */
  async baseline(url: string): Promise<{ id: string; name: string; trackCount: number }> {
    const ref = parsePlaylistUrl(url);
    const snapshot = await this.client.getPlaylist(ref);
    const currentIds = snapshot.tracks.map((t) => t.id);
    this.saveSnapshot(ref.id, url, snapshot.name, currentIds);
    return { id: ref.id, name: snapshot.name, trackCount: currentIds.length };
  }

  private saveSnapshot(
    id: string,
    url: string,
    name: string,
    trackIds: string[],
  ): void {
    const snap: PlaylistState = {
      name,
      url,
      trackIds,
      trackCount: trackIds.length,
      initialized: true,
      lastChecked: new Date().toISOString(),
    };
    this.store.setSnapshot(id, snap);
  }
}
