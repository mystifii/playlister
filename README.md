# Playlister

A small self-hosted bot that watches **Apple Music playlists** and posts to a
**Discord channel** whenever a new song is added.

It polls each playlist on an interval, diffs the track list against the last
snapshot, and sends a rich Discord embed for every newly added track.

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

### 1. Get a Discord webhook

In your Discord server: **Server Settings → Integrations → Webhooks → New
Webhook**, pick the channel, and **Copy Webhook URL**.

### 2. Get your playlist share link(s)

In the Music app, open the playlist → **⋯ → Share → Copy Link**. You'll get a
URL like:

```
https://music.apple.com/us/playlist/my-mix/pl.u-xxxxxxxxxxxx
```

Make sure the playlist is shared/public.

### 3. Configure

```bash
cp .env.example .env
# then edit .env
```

| Variable | Description |
| --- | --- |
| `DISCORD_WEBHOOK_URL` | Your Discord channel webhook URL. |
| `PLAYLISTS` | One or more public playlist URLs, comma- or newline-separated. |
| `POLL_INTERVAL_SECONDS` | How often to check (default `300`). |
| `STATE_FILE` | Where snapshots are saved (default `./data/state.json`). |

## Running

### With Node (>= 18)

```bash
npm install
npm run build
npm start
```

For development without building:

```bash
npm run dev
```

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
  index.ts                 # entry point + polling loop
  config.ts                # env config loading/validation
  watcher.ts               # fetch -> diff -> notify -> persist
  apple/public-client.ts   # reads public playlists via the web token
  discord/notify.ts        # Discord webhook embeds
  store/state.ts           # JSON snapshot persistence
```

## Notes & tuning

- **Polling interval:** 5 minutes is a reasonable default. Lower it for faster
  notifications, but be polite to Apple's servers.
- **Multiple playlists:** add them all to `PLAYLISTS`; each is tracked
  independently.
- **Resetting a playlist's baseline:** stop the bot, edit/remove that
  playlist's entry in `state.json`, and restart.
- **Debug logging:** set `DEBUG=1` in the environment.
