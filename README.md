# Soundclash

![Soundclash](public/brand/wordmark.png)

![Next.js](https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

**▶️ [Live demo](https://soundclash-production-9c06.up.railway.app/) · 📺 [90-second walkthrough](https://www.youtube.com/watch?v=i-jfkAoH054)**

> Best played live: open the demo on a laptop/TV as the **host**, then join from your **phone**
> (scan the on-screen QR or go to `/join`). Many rooms can run in parallel.

Soundclash is a zero-install music party game for the Musixmatch Musicathon 2026.
One device hosts the room, players join on phones, and an AI host runs lyric-based
mini-games powered by live Musixmatch data.

The current product direction is a Jackbox-style show with a strong cassette/Y2K
identity: cream J-cards, clear plastic, chrome, holographic accents, neon magenta,
cyber teal, electric tangerine, LED scoreboards, stickers, and tape-label UI.

## How Soundclash uses Musixmatch

Musixmatch is the game engine, not a garnish — the lyric data **is** the puzzle:

| Musixmatch surface | Powers |
|---|---|
| `track.search` (by artist / genre / free text, `f_has_lyrics`, rating sort) | Building the host's track deck |
| `music.genres.get` | Genre-based deck building |
| `track.lyrics.get` (full lyrics) | Finish the Line, Misheard, Next Line round content |
| `track.richsync.get` (word-level synced) | The word-synced lyric preview / word-timed reveals |
| `track.get` | Track metadata & matching |

Used in **real time only**: lyrics are fetched per request (`cache: "no-store"`) and **never
persisted** — rounds store *references* (`track_id`, `line_index`, `seed`), and the
`lyrics_copyright` string + Musixmatch tracking pixel render on **every** lyric view. The
forbidden `track.lyrics.mood.get` (403 on the contest key) is never called. Full posture:
[`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md).

## Current Experience

- Host creates a shared-screen room at `/host/new` and picks a **narrator language** (29 options).
- Players join from `/join` or a room link on their phones.
- Host can tap **Auto-pick show** once; the session then rotates a host-chosen **3-, 6-, or 9-round** set (default 6).
- Host builds the track deck by **artist**, **genre**, or free-text **song** search.
- Mini-games are mostly tap-based to keep phone input fast.
- ElevenLabs voices handle room intro, round transitions, reveals, leaders, and final-score moments, in the chosen language.
- A personalized ElevenLabs Music v2 signature powers the animated home waveform.
- LALAL.AI split assets are kept for the upcoming Signal Check micro-game, but the home currently plays only the full mix.

## Mini-games

The autopilot rotates a host-chosen 3-, 6-, or 9-round set (default 6) drawn from this catalog.
Each game declares the content it needs, and the host can't start a round whose source isn't
ready — there are **no silent swaps**:

| Game | Category | What you do | Powered by |
|---|---|---|---|
| Finish the Line | Lyrics | Tap the missing last word | Musixmatch lyrics |
| Misheard | Lyrics | Spot the real lyric among the mondegreens | Musixmatch lyrics |
| Next Line | Lyrics | Pick the line that comes next | Musixmatch lyrics |
| Genre Roulette | Trivia | Name the vibe of the generated beat | ElevenLabs Music |
| Beat Lock | Timing | Tap on the beat — timing scores | ElevenLabs Music |
| Stem Heist | Trivia | Name the track from one isolated stem | LALAL.AI stems (host upload) |
| Voice Clash | Trivia | The host's cloned voice drops a track — rate it | ElevenLabs voice clone |

The three lyrics games run on **any** Musixmatch track; their tempting wrong answers are written
live by Claude when `ANTHROPIC_API_KEY` is set, falling back to local heuristics otherwise.

A "coming soon" gallery (Karaoke Clash, Rap Battle) is shown in the host picker for the pitch
but never enters rotation.

## Online & multiplayer

- One host on a shared screen/TV; everyone else plays from their own phone — **no install**.
- Players join by **room code or QR** (`/join` or the QR on the host screen).
- Host and phones stay in sync via lightweight **1s HTTP polling** (no WebSocket needed).
- **Many rooms run in parallel** (keyed by code) and there is **no player cap** per room.
- Sessions live in the server process: this works great on **one always-on instance**.
  A redeploy/restart clears active rooms — moving the session store to Redis/Supabase
  (planned) makes rooms survive restarts and enables serverless/multi-instance.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js App Router, React, TypeScript |
| Styling | Tailwind + Soundclash brand utilities |
| Lyrics | Musixmatch server-side proxy |
| Voice + soundtrack | ElevenLabs server-side proxy + generated static MP3 assets |
| Stem separation | LALAL.AI server-side proxy |
| Future persistence | Supabase Postgres + Realtime |

## Provider Status

| Provider | Use | Status |
|---|---|---|
| Musixmatch | Search, lyrics, richsync, track metadata | Verified |
| ElevenLabs | AI host text-to-speech | Verified |
| LALAL.AI | Stem separation lab | Wired |
| Supabase | Persistence/realtime target | Planned for room hardening |
| Anthropic Claude | Lyric-game distractors, Voice Clash bars, host-banter localization | Wired |

## Status & known limitations

This is a working demo built for the Musicathon. We'd rather be precise about what
is live than overclaim — what's shipped today and what's intentionally still ahead:

- **Sessions are in-memory.** Rooms live in the server process, so a redeploy/restart
  clears active rooms. The app is pinned to a **single always-on instance**; moving the
  store to Redis/Supabase (planned) is what enables persistence and multi-instance.
- **No auth on the API routes.** Any client with the 4-char room code can drive the room.
  That's fine for a trusted in-person party/demo; host/player tokens are planned hardening.
- **Claude has three narrow, server-side uses** (`lib/server/anthropic.ts`, all via raw `fetch` —
  no SDK — with `cache: "no-store"`, never logged, never written to disk/DB):
  - **Lyric-game distractors** (`generateLyricChoices`, `claude-sonnet-4-6`): for Finish the
    Line / Next Line / Misheard, Claude is sent the **real lyric line + correct answer** and
    returns tempting wrong options. Active when `ANTHROPIC_API_KEY` is set; otherwise local
    heuristics. Results are cached in memory per line for the warm process only.
  - **Voice Clash bars** (`writeBars`, `claude-opus-4-8`): sent the round theme + **player
    names**, returns short rap bars read aloud by the host's cloned voice.
  - **Host-banter localization** (`resolveBanterPack`, `claude-opus-4-8`): non-en/it narrator
    languages are localized once and cached. Here Claude only ever sees `{placeholder}` template
    strings — no lyrics, names, or session data. English/Italian use static packs, and without a
    key these languages fall back to the English pack so the show still runs.
- **Combo/Encore scoring** is live in solo mode; party rounds currently score base + speed
  (per-player streak wiring is in progress).

The `docs/` folder additionally documents a **target architecture** (Supabase, Claude,
async challenges) that is a roadmap, not the current build — each doc flags what is
implemented today versus planned.

## Local Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Never commit `.env.local`. All provider keys are server-side only; browser clients
call this app's `/api/**` routes, and those routes call providers.

To regenerate the instrumental gameplay loops with ElevenLabs Music v2:

```bash
npm run soundtrack:generate
```

This writes `public/audio/soundclash-mixtape.mp3` and `public/audio/soundclash-clash.mp3`.
The browser tries to start playback automatically, then falls back to the first
tap if autoplay is blocked.

To regenerate the personalized home signature and split it with LALAL.AI:

```bash
npm run soundtrack:signature
```

This writes:

- `public/audio/soundclash-signal-full.mp3`
- `public/audio/soundclash-signal-vocals.mp3`
- `public/audio/soundclash-signal-backing.mp3`

## Deploy (Railway)

Soundclash is a standard Next.js server — deploy it to a **single always-on instance**.
The live demo runs on **Railway**: [soundclash-production-9c06.up.railway.app](https://soundclash-production-9c06.up.railway.app/).

- **Single instance, by design:** room sessions live in the server process, so the app runs
  on **one** replica (`railway.json` pins `numReplicas: 1`). A multi-instance/autoscale setup
  would split rooms across instances and break sharing.
- **Build:** `npm run build` · **Run:** `npm run start` (binds `0.0.0.0:$PORT`).
- **Secrets:** `MXM_KEY` (required) + optional `ELEVENLABS_API_KEY` / voice ids,
  `ANTHROPIC_API_KEY` (lyric distractors + Voice Clash bars + non-en/it banter), and
  `LALAL_API_KEY` (Stem Heist).
- Step-by-step: [`docs/DEPLOY_RAILWAY.md`](./docs/DEPLOY_RAILWAY.md). Replit (Reserved VM) also works.

Once deployed you get a public HTTPS URL; the join QR/links resolve to it automatically,
so judges/players can join from anywhere in the world.

## Documentation

Start with [`docs/README.md`](./docs/README.md). The key docs are:

- [`docs/DEPLOY_RAILWAY.md`](./docs/DEPLOY_RAILWAY.md) — how to publish (Railway single instance; Replit also works).
- [`docs/BRAND_SYSTEM.md`](./docs/BRAND_SYSTEM.md) — visual system and mood-board rules.
- [`docs/PARTY_ROOM_PLAN.md`](./docs/PARTY_ROOM_PLAN.md) — current room flow and mini-game plan.
- [`docs/API_INTEGRATION.md`](./docs/API_INTEGRATION.md) — provider wiring.
- [`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md) — Musixmatch usage rules.

## Musixmatch Compliance

Persist only references. Do not store lyric text, richsync payloads, lyric snippets,
or generated answer text beyond the active transient round. Whenever lyrics are
shown, display the Musixmatch copyright/tracking requirements.
