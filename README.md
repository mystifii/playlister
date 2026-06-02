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

Playlister is managed from its **web UI** — you only need one bit of config to
start it, then add playlists from the browser.

### 1. Get a Discord webhook

In your Discord server: **Server Settings → Integrations → Webhooks → New
Webhook**, pick the channel, and **Copy Webhook URL**.

### 2. Configure & start

```bash
cp .env.example .env          # set DISCORD_WEBHOOK_URL — that's the only required value
npm install && npm run build && npm start
```

(or with Docker: `docker compose up -d --build`)

### 3. Add playlists in the web UI

Open <http://localhost:8080>. To add a playlist, grab its share link in the
Music app (**⋯ → Share → Copy Link**) — make sure the playlist is
shared/public — and paste it in. You'll get a link like:

```
https://music.apple.com/us/playlist/my-mix/pl.u-xxxxxxxxxxxx
```

The UI validates the link, loads its name and track count immediately, and
starts watching it. Remove a playlist with one click. The watch list is saved
to `state.json` and the running bot picks up changes on its next poll — no
restart needed.

> The UI has no authentication — keep it on localhost or a trusted network, or
> put it behind a reverse proxy with auth if you expose it.

That's it. New songs added to any watched playlist will show up in your Discord
channel.

## Configuration reference

All configuration is via environment variables (see `.env.example`):

| Variable | Description |
| --- | --- |
| `DISCORD_WEBHOOK_URL` | **Required.** Your Discord channel webhook URL. |
| `WEB_PORT` | Port for the management web UI (default `8080`). |
| `POLL_INTERVAL_SECONDS` | How often to check (default `300`). |
| `STATE_FILE` | Where the watch list + snapshots are saved (default `./data/state.json`). |
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
