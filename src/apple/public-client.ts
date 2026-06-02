import { logger } from "../logger.js";

const WEB_APP_URL = "https://music.apple.com/us/browse";
const AMP_API_BASE = "https://amp-api.music.apple.com";

export interface Track {
  /** Apple Music catalog id — stable identifier used for diffing. */
  id: string;
  name: string;
  artistName: string;
  albumName?: string;
  url?: string;
  artworkUrl?: string;
}

export interface PlaylistSnapshot {
  id: string;
  name: string;
  tracks: Track[];
}

/** Parsed identity of a shared playlist URL. */
export interface PlaylistRef {
  storefront: string;
  id: string;
}

/**
 * Pull the storefront + playlist id out of a public share link, e.g.
 *   https://music.apple.com/us/playlist/my-mix/pl.u-abc123  ->  { us, pl.u-abc123 }
 */
export function parsePlaylistUrl(url: string): PlaylistRef {
  const m = url.match(
    /music\.apple\.com\/([a-z]{2})\/playlist\/[^/]+\/(pl\.[A-Za-z0-9-]+)/i,
  );
  if (!m) {
    throw new Error(
      `Could not parse an Apple Music playlist id from "${url}". ` +
        `Expected a link like https://music.apple.com/us/playlist/name/pl.u-xxxx`,
    );
  }
  return { storefront: m[1].toLowerCase(), id: m[2] };
}

/**
 * The Apple Music web player calls its backend (amp-api) with an anonymous
 * bearer token that is embedded in its JS bundle. We discover that token once
 * and reuse it; it is the same for all anonymous visitors and lives for months.
 * This is what lets us read user-shared playlists without any developer
 * account or user authorization.
 */
export class AppleMusicPublicClient {
  private token: string | null = null;

  /** Fetch and cache the anonymous web-player token. */
  private async getToken(forceRefresh = false): Promise<string> {
    if (this.token && !forceRefresh) return this.token;

    const homepage = await fetchText(WEB_APP_URL);
    // The web app loads a main JS chunk under /assets/.
    const bundleMatch = homepage.match(/\/assets\/index[-.][^"']+\.js/);
    if (!bundleMatch) {
      throw new Error(
        "Could not locate the Apple Music web bundle — the page layout may have changed.",
      );
    }
    const bundle = await fetchText("https://music.apple.com" + bundleMatch[0]);
    // The bearer token is a JWT (three base64url segments) embedded in the JS.
    const tokenMatch = bundle.match(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    if (!tokenMatch) {
      throw new Error(
        "Could not extract the anonymous Apple Music token from the web bundle.",
      );
    }
    this.token = tokenMatch[0];
    logger.debug("Obtained anonymous Apple Music token.");
    return this.token;
  }

  private async ampRequest<T>(path: string): Promise<T> {
    const doFetch = async (token: string) =>
      fetch(`${AMP_API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://music.apple.com",
          "Accept-Language": "en-US",
        },
      });

    let res = await doFetch(await this.getToken());
    // A stale token shows up as 401/403 — refresh once and retry.
    if (res.status === 401 || res.status === 403) {
      logger.warn("Anonymous token rejected; refreshing and retrying.");
      res = await doFetch(await this.getToken(true));
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404) {
        throw new Error(
          `Playlist not found (404) for ${path}. Is the playlist still public/shared?`,
        );
      }
      throw new Error(`Apple Music amp-api ${res.status} for ${path}: ${body}`);
    }
    return (await res.json()) as T;
  }

  /** Fetch a playlist's name and full (paginated) track listing. */
  async getPlaylist(ref: PlaylistRef): Promise<PlaylistSnapshot> {
    interface PlaylistResponse {
      data: Array<{ id: string; attributes?: { name?: string } }>;
    }
    const meta = await this.ampRequest<PlaylistResponse>(
      `/v1/catalog/${ref.storefront}/playlists/${ref.id}`,
    );
    const name = meta.data?.[0]?.attributes?.name ?? "(untitled playlist)";

    const tracks = await this.getAllTracks(ref);
    return { id: ref.id, name, tracks };
  }

  private async getAllTracks(ref: PlaylistRef): Promise<Track[]> {
    interface RawTrack {
      id: string;
      attributes?: {
        name?: string;
        artistName?: string;
        albumName?: string;
        url?: string;
        artwork?: { url?: string };
      };
    }
    interface TracksPage {
      data: RawTrack[];
      next?: string;
    }

    const out: Track[] = [];
    let path: string | undefined =
      `/v1/catalog/${ref.storefront}/playlists/${ref.id}/tracks?limit=100`;
    while (path) {
      const page: TracksPage = await this.ampRequest<TracksPage>(path);
      for (const t of page.data ?? []) {
        out.push({
          id: t.id,
          name: t.attributes?.name ?? "(unknown title)",
          artistName: t.attributes?.artistName ?? "Unknown artist",
          albumName: t.attributes?.albumName,
          url: t.attributes?.url,
          artworkUrl: resolveArtwork(t.attributes?.artwork?.url),
        });
      }
      path = page.next ? page.next.replace(AMP_API_BASE, "") : undefined;
    }
    return out;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // A browser-like UA avoids edge-case blocking on the web assets.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} failed with ${res.status}`);
  }
  return res.text();
}

/** Apple artwork URLs contain {w}/{h} placeholders that must be substituted. */
function resolveArtwork(template?: string, size = 256): string | undefined {
  if (!template) return undefined;
  return template
    .replace("{w}", String(size))
    .replace("{h}", String(size))
    .replace("{f}", "jpg");
}
