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
        // One bad playlist shouldn't stop the others or kill the loop. Record
        // the failure so it surfaces in the UI instead of just a stale time.
        const message = (err as Error).message;
        logger.error(`Failed to poll ${url}: ${message}`);
        this.store.recordPollError(url, message);
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

    if (newTracks.length === 0) {
      // No additions: advance the snapshot (refreshes lastChecked, clears any
      // prior error) and move on.
      this.saveSnapshot(ref.id, url, snapshot.name, currentIds);
      logger.debug(`"${snapshot.name}": no changes.`);
      return;
    }

    logger.info(`"${snapshot.name}": ${newTracks.length} new track(s) detected.`);

    // Delivery is decoupled from polling: only advance the snapshot once the
    // notifications are delivered, so a Discord failure (e.g. missing
    // permissions) doesn't freeze the checked-time or drop the additions — they
    // are retried next poll and arrive once the problem is fixed.
    try {
      await this.deliver(url, snapshot.name, newTracks);
      this.saveSnapshot(ref.id, url, snapshot.name, currentIds);
    } catch (err) {
      const message = `Discord delivery failed: ${(err as Error).message}`;
      logger.error(`"${snapshot.name}": ${message}`);
      this.markDeliveryFailed(ref.id, snapshot.name, message);
    }
  }

  /** Resolve the destination and send notifications; throws if it can't. */
  private async deliver(
    url: string,
    playlistName: string,
    newTracks: Track[],
  ): Promise<void> {
    const destination = this.store.effectiveDestination(url);
    if (!destination) {
      throw new Error("No Discord destination configured — set one in the web UI.");
    }
    const botToken = this.store.getBotToken();
    if (destination.type === "channel" && !botToken) {
      throw new Error(
        "Posts to a channel/thread but no bot token is set — add one in the web UI.",
      );
    }
    await notifyTracksAdded(
      destination,
      botToken,
      newTracks.map((track) => ({ playlistName, playlistUrl: url, track })),
    );
  }

  /**
   * Record a delivery failure: refresh lastChecked (the poll itself worked) and
   * note the error, but keep the previous trackIds so the undelivered additions
   * are retried on the next poll.
   */
  private markDeliveryFailed(id: string, name: string, message: string): void {
    const prev = this.store.getSnapshot(id);
    if (!prev) return;
    this.store.setSnapshot(id, {
      ...prev,
      name,
      lastChecked: new Date().toISOString(),
      lastError: message,
      lastErrorAt: new Date().toISOString(),
    });
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
