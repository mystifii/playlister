# Playlister

A small self-hosted bot that watches **Apple Music playlists** and posts to a
**Discord channel** whenever a new song is added.

It polls each playlist on an interval, diffs the track list against the last
snapshot, and sends a rich Discord embed for every newly added track. A small
**web UI** lets you add and remove watched playlists without touching config
files.

## How it works (and what it can/can't do)

- **No Apple Developer account or login required.** Playlister reads **public
  Apple Music share links**. It uses the same anonymous token the Apple Music
  *web player* uses, so there is no `.p8` key, no OAuth, and no Music User
  Token to manage.
- It detects **that** a song was added, not **who** added it. The Apple Music
  API does not expose per-track contributors, even for collaborative
  playlists, so notifications say *"X was added to Playlist Y"*.
- It only works for playlists you've made **public / shared via link**. Private
  playlists aren't reachable this way.
- The first time it sees a playlist it records a **baseline silently** — you
  won't get spammed with every existing track. Only songs added *after* that
  first poll trigger notifications.

> Note: this relies on the public Apple Music web endpoints, which are
> unofficial. They've been stable for a long time, but Apple could change them.

## Setup

Playlister is managed entirely from its **web UI** — no config files required
to get going.

### 1. Start it

```bash
npm install && npm run build && npm start
```

(or with Docker: `docker compose up -d --build`)

### 2. Open the web UI

Go to <http://localhost:8080>. From there:

- **Set your Discord webhook.** In Discord: **Server Settings → Integrations →
  Webhooks → New Webhook**, pick the channel, **Copy Webhook URL**, and paste
  it into the *Discord notifications* box. (The stored token is masked in the UI
  and never sent back to the browser.)
- **Add playlists.** Grab a playlist's share link in the Music app (**⋯ →
  Share → Copy Link**) — make sure it's shared/public — and paste it in. It
  looks like `https://music.apple.com/us/playlist/my-mix/pl.u-xxxxxxxxxxxx`.
  The UI validates the link, loads its name and track count immediately, and
  starts watching it. Remove a playlist with one click.

Both the webhook and the watch list are saved to `state.json`, and the running
bot picks up changes on its next poll — no restart needed.

> The UI has no authentication — keep it on localhost or a trusted network, or
> put it behind a reverse proxy with auth if you expose it.

That's it. New songs added to any watched playlist will show up in your Discord
channel. (If no webhook is set yet, the bot still tracks playlists and logs a
reminder; it just won't post until you add one.)

## Configuration reference

Every variable is optional — these just set defaults or seed first-run values;
the webhook and playlists are normally managed in the web UI (see
`.env.example`):

| Variable | Description |
| --- | --- |
| `WEB_PORT` | Port for the management web UI (default `8080`). |
| `POLL_INTERVAL_SECONDS` | How often to check (default `300`). |
| `STATE_FILE` | Where settings + watch list + snapshots are saved (default `./data/state.json`). |
| `DISCORD_WEBHOOK_URL` | *Optional.* Seeds the webhook on the **first run** only; afterwards the web UI is the source of truth. |
| `PLAYLISTS` | *Optional.* Seed playlist URLs (comma/newline separated) used only on the **first run** to pre-populate the watch list. After that, manage playlists in the web UI. |

## Running

### With Node (>= 18)

```bash
npm install
npm run build
npm start
```

For development without building, use `npm run dev`.

### With Docker

```bash
docker compose up -d --build
```

State is persisted to `./data` via a mounted volume, so snapshots survive
restarts.

A prebuilt multi-arch image (amd64/arm64) is published to GHCR on every push
to `main`:

```bash
docker run -d --name playlister \
  -p 8080:8080 \
  -v /path/to/appdata/playlister:/app/data \
  ghcr.io/mystifii/playlister:latest
```

Then open <http://localhost:8080> and configure it there.

### On Unraid

Playlister runs as a normal Docker container using the prebuilt GHCR image.

1. **Make sure the image is public.** After the first successful
   [Publish Docker image](.github/workflows/docker-publish.yml) workflow run,
   go to the package on GitHub
   (`github.com/users/mystifii/packages/container/playlister/settings`) and set
   its visibility to **Public** so Unraid can pull it without credentials.
   (Alternatively, add GHCR registry credentials under
   **Docker → enable advanced view → add a registry** in Unraid.)
2. **Add the container.** Easiest is to import the template: in Unraid go to
   **Docker → Add Container**, and in the *Template* field paste:

   ```
   https://raw.githubusercontent.com/mystifii/playlister/main/unraid/playlister.xml
   ```

   It pre-fills everything below. Or fill it in manually:
   - **Repository:** `ghcr.io/mystifii/playlister:latest`
   - **WebUI Port:** host `8080` → container `8080` (TCP)
   - **App Data path:** `/mnt/user/appdata/playlister` → container `/app/data`
   - Env vars (`DISCORD_WEBHOOK_URL`, `PLAYLISTS`, `POLL_INTERVAL_SECONDS`) are
     all **optional** — leave them blank and configure everything in the web UI.
3. **Apply**, wait for it to pull, then click the container's **WebUI** button
   (or browse to `http://<tower-ip>:8080`). Set your Discord webhook and add
   playlists there.

Everything lives in `/mnt/user/appdata/playlister/state.json`, so your config
survives container updates and restarts. To update, just re-pull the image from
Unraid's Docker tab.

### With systemd

See [`deploy/playlister.service`](deploy/playlister.service) for an example
unit file.

## Project layout

```
src/
  index.ts                 # entry point: web server + polling loop
  config.ts                # env config loading/validation
  watcher.ts               # fetch -> diff -> notify -> persist
  apple/public-client.ts   # reads public playlists via the web token
  discord/notify.ts        # Discord webhook embeds
  store/state.ts           # watch list + JSON snapshot persistence
  web/server.ts            # Express management API
  web/page.ts              # the (self-contained) web UI
```

## Notes & tuning

- **Polling interval:** 5 minutes is a reasonable default. Lower it for faster
  notifications, but be polite to Apple's servers.
- **Multiple playlists:** add as many as you like in the web UI; each is
  tracked independently.
- **Resetting a playlist's baseline:** stop the bot, edit/remove that
  playlist's entry in `state.json`, and restart.
- **Debug logging:** set `DEBUG=1` in the environment.
