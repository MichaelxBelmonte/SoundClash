# System Architecture

> **Status — target vs. current build.** This document describes the *target* architecture, parts of which are not yet built. In particular, **Supabase (Postgres/Auth/RLS), leaderboards, all DB persistence, and Anthropic Claude (round generation, mood, host banter) are PLANNED, not implemented.** Likewise the routes `/api/round`, `/api/host`, `/api/mood`, `/api/challenge`, `/api/stems`, and the async `/c/[slug]` challenge flow do not exist yet. The current build uses an **in-memory session store** (`lib/server/session-store.ts`, a per-instance Map, no DB) synced via ~1s HTTP polling, and templated (non-LLM) host banter. For exactly what is live today, see the "Status & known limitations" section of [../README.md](../README.md).

Soundclash is a web party game built on real song lyrics with an AI host, for the Musixmatch Musicathon 2026. This document describes how the system is structured: the trust boundary between the browser and the providers, the App Router folder layout, the end-to-end data flow for one round, room state, and the rationale behind each technology choice.

This is the engineering source of truth for *how the pieces fit together*. For *what* the product does, see [PRODUCT_SPEC.md](./PRODUCT_SPEC.md). For visual implementation rules, see [BRAND_SYSTEM.md](./BRAND_SYSTEM.md). For the current room/autopilot plan, see [PARTY_ROOM_PLAN.md](./PARTY_ROOM_PLAN.md).

> Current implementation note: the app has already pivoted from a primarily async challenge MVP to a Jackbox-style shared-room show. Some Supabase/Claude sections below remain the target architecture for persistence, leaderboards, mood-aware generation, and richer host banter.

---

## 1. High-Level Diagram

Everything outbound to a third-party provider goes through the Next.js server. The browser never talks to Musixmatch, ElevenLabs, or LALAL.AI directly. (⏳ Planned: Claude as a fourth provider behind the same proxy.) In the target architecture the browser *does* talk to Supabase directly — but only through the publishable key, with Row-Level Security as the enforcement layer. **Today there is no Supabase and no Claude:** session state lives in an in-memory store on the server and host banter is templated, so the Supabase channel and the Claude box below are PLANNED.

```
                            ┌──────────────────────────────────────────────┐
                            │                  BROWSER                     │
                            │   React client (App Router, Tailwind)        │
                            │   - renders rounds, timers, host audio       │
                            │   - holds only NEXT_PUBLIC_* values          │
                            └───────────────┬──────────────────┬───────────┘
                                            │                  │
              fetch() to OUR origin only    │                  │  supabase-js (publishable key)
              (route handlers / actions)    │                  │  reads/writes guarded by RLS
                                            │                  │
                                            ▼                  ▼
   ┌────────────────────────────────────────────────┐   ┌─────────────────────────────────┐
   │        NEXT.JS SERVER  (the proxy)              │   │           SUPABASE              │
   │  Route Handlers (app/api/*) + Server Actions    │   │  Postgres + Auth + RLS          │
   │                                                 │   │  profiles / games / rounds /    │
   │  Holds server-side secrets (process.env):       │   │  challenges / scores            │
   │   MXM_KEY                                        │   │  view: leaderboard_global       │
   │   ELEVENLABS_API_KEY                             │   └───────────────┬─────────────────┘
   │   ANTHROPIC_API_KEY                              │                   │ service-role
   │   SUPABASE_DB_PASSWORD / SUPABASE_PROJECT_REF    │◄──────────────────┘ writes (server-side
   │                                                 │                     when needed)
   └───┬──────────────┬──────────────┬───────────┬───┘
       │              │              │           │
       ▼              ▼              ▼           ▼
 ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐
 │ Musixmatch│  │ElevenLabs │  │  Claude  │  │ LALAL.AI  │
 │ lyrics /  │  │  TTS      │  │ opus-4-8 │  │  stems    │
 │ richsync /│  │ (host     │  │ round    │  │ (karaoke, │
 │ search /  │  │  voice)   │  │ gen +    │  │  optional)│
 │ subtitle  │  │           │  │ banter   │  │           │
 └───────────┘  └───────────┘  └──────────┘  └───────────┘
   server-side    server-side    server-side    server-side
   MXM_KEY        xi-api-key     ANTHROPIC_KEY   LALAL_API_KEY
```

**Two distinct channels to data:**

| Channel | Who initiates | Auth | Used for | Status |
|---|---|---|---|---|
| Provider proxy | Browser → our server → provider | Server-side secrets in `process.env` | Lyrics, TTS, stems (Claude generation ⏳ planned) | Implemented (Claude ⏳ Planned) |
| Supabase | Browser → Supabase (direct) | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + RLS | Scores, challenges, leaderboards, profiles | ⏳ Planned |

---

## 2. The Server-Proxy Security Pattern

> **Hard rule (from the canonical brief): ALL provider calls happen ONLY in Next.js server (route handlers / server actions) acting as a proxy. The browser NEVER sees server-side keys.**

### Why a proxy at all

Musixmatch, ElevenLabs, Claude, and LALAL.AI all authenticate with a long-lived secret. If any of those secrets shipped in a client bundle — even minified, even behind an "internal" flag — it would be trivially extractable from the browser and immediately abusable (quota theft, billing, abuse attribution back to us). A public GitHub repo (`github.com/MichaelxBelmonte/SoundClash`) makes the bar even higher: nothing secret can live in committed source either.

The pattern is: **the browser only ever calls our own origin.** Our server is the single place that holds provider secrets and the single place that calls providers.

### How secrets are scoped

Next.js treats any env var prefixed `NEXT_PUBLIC_` as inlined-into-the-client and everything else as server-only. We lean on that split exactly as the brief specifies.

| Variable | Exposure | Where it is read | Status |
|---|---|---|---|
| `MXM_KEY` | Server-only | Route handlers / server actions calling Musixmatch | Implemented |
| `ELEVENLABS_API_KEY` | Server-only | Route handler calling ElevenLabs TTS (`xi-api-key` header) | Implemented |
| `LALAL_API_KEY` | Server-only | Route handler calling LALAL.AI (optional, karaoke) | Implemented |
| `ANTHROPIC_API_KEY` | Server-only | Server-side `@anthropic-ai/sdk` client | ⏳ Planned |
| `SUPABASE_DB_PASSWORD` | Server-only | Migrations / direct Postgres only — never at runtime in app code | ⏳ Planned |
| `SUPABASE_PROJECT_REF` | Server-only | CLI / migrations tooling | ⏳ Planned |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | supabase-js in the browser | ⏳ Planned |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | supabase-js in the browser | ⏳ Planned |

⏳ Planned: only the two `NEXT_PUBLIC_SUPABASE_*` values will reach the browser. They are *designed* to be public: the publishable key grants nothing on its own — Row-Level Security on every table is what actually authorizes reads and writes. (None of the Supabase or Anthropic variables are used in the current build.)

### Secret hygiene

- Secrets live only in `.env.local`, which is gitignored (`.env*` is ignored with a `!.env.example` exception). `.env.example` documents the variable names with placeholder values and is the only env file committed.
- In production on Replit, the same variables are re-entered as Replit Secrets — never committed.
- **Rotation note (from the brief):** some keys were pasted into chat during development. The ElevenLabs key and the Supabase DB password should be rotated before the public demo.

### Server-side hardening of the proxy

The proxy is not a dumb pass-through. Each provider route handler:

1. Reads its secret from `process.env` at request time (never imported into a shared client module that could leak into a client bundle).
2. Validates and narrows the request — a client asks for "the round for `gameId`/`position`", not "fetch this arbitrary Musixmatch URL." This prevents the proxy from becoming an open relay.
3. Returns only what the client needs for transient display. Lyric *text* is returned for rendering but never persisted (see §4 and §5).

```ts
// app/api/round/route.ts — ⏳ PLANNED, ILLUSTRATIVE shape of a proxy route handler.
// This route does not exist yet (no Claude). The real proxy routes today are
// app/api/mxm/*, app/api/host/speak, app/api/lalal/*, app/api/rounds/*, app/api/sessions/*.
// Secrets are read here, on the server, and never serialized to the client.
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { gameId, position } = await req.json();

  // MXM_KEY and ANTHROPIC_API_KEY exist only in this process, never in the browser bundle.
  const mxmKey = process.env.MXM_KEY!;
  const round = await buildRoundLive({ gameId, position, mxmKey }); // fetch + Claude

  // Returns the transient Round (prompt/options/answer text) for display only.
  return NextResponse.json(round);
}
```

---

## 3. Folder Structure (Next.js App Router)

A pragmatic App Router layout for a solo, ~5-day build. The hard boundary is `lib/server/` vs. client modules: anything that imports a server-side secret must live under `lib/server/` (or directly in a route handler / server action) so it can never be pulled into a client component bundle. The tree below is the **current, real layout**; entries tagged ⏳ Planned do not exist yet.

```
soundclash/
├─ app/
│  ├─ layout.tsx                 # root layout, Tailwind, fonts
│  ├─ page.tsx                   # landing / create-or-join
│  ├─ globals.css
│  │
│  ├─ host/
│  │  ├─ new/page.tsx            # create a session
│  │  └─ [code]/page.tsx         # TV/stage screen
│  ├─ join/page.tsx              # bind a phone to a room
│  ├─ player/
│  │  └─ [code]/page.tsx         # phone controller
│  ├─ solo/page.tsx              # single-screen solo flow
│  │
│  └─ api/                       # ── route handlers = the provider proxy ──
│     ├─ mxm/
│     │  ├─ search/route.ts      # GET: Musixmatch track.search (proxy)
│     │  ├─ track/route.ts       # GET: Musixmatch track + lyrics (proxy)
│     │  └─ richsync/route.ts    # GET: Musixmatch richsync (proxy)
│     ├─ host/
│     │  └─ speak/route.ts       # POST: ElevenLabs TTS (audio)
│     ├─ lalal/
│     │  ├─ stems/route.ts       # POST: LALAL.AI stem separation (optional)
│     │  └─ stems/[taskId]/route.ts  # GET: poll stem task
│     ├─ rounds/
│     │  ├─ check/route.ts       # POST: server-side answer regeneration/check
│     │  └─ finish-line/route.ts # POST: finish-the-line round logic
│     └─ sessions/
│        ├─ route.ts             # POST: create session
│        └─ [code]/
│           ├─ route.ts          # GET poll / PATCH reveal / lobby
│           ├─ join/route.ts     # POST: player joins
│           └─ round/route.ts    # POST start/advance, PATCH submit answer
│
├─ components/
│  ├─ app/                       # TopBar, BottomNav
│  ├─ audio/                     # AudioDirector, HomeWaveform
│  ├─ battle/                    # DuelResult, MatchResult
│  ├─ brand/                     # Logo, Button, JCard, BrandIntro, …
│  ├─ onboarding/                # Soundcheck
│  ├─ richsync/                  # LiveLyricPreview
│  ├─ rounds/                    # FinishLineGame
│  ├─ search/                    # SearchExperience, SearchForm, TrackResults
│  ├─ session/                   # HostRoom, PlayerRoom, JoinSession, AudioConsole,
│  │                             #   CreateSession, JoinQr, MiniGameArt, MusixmatchTracking
│  ├─ team/                      # TeamBuilder, TeamSummary
│  └─ ui/                        # Avatar, Icon
│
├─ lib/
│  ├─ server/                    # SERVER-ONLY. Imports secrets. Never imported by a client component.
│  │  ├─ musixmatch.ts           # track.search / track + lyrics / richsync (MXM_KEY)
│  │  ├─ elevenlabs.ts           # TTS POST /v1/text-to-speech/{voice_id} (composeMusic unused)
│  │  ├─ lalal.ts                # stem separation (optional)
│  │  └─ session-store.ts        # in-memory active-session store (module-global Map, no DB)
│  │
│  ├─ game/                      # artists, challenge, finish-line, host-banter (templates),
│  │                             #   identity, scoring
│  ├─ session/                   # mini-games (9), avatars, types
│  ├─ audio/                     # soundtrack
│  ├─ i18n.ts
│  └─ types.ts                   # shared runtime types
│
├─ public/                       # static assets
│  ├─ audio/
│  └─ brand/
│
├─ .env.example                  # variable names only (committed)
├─ .env.local                    # secrets (gitignored)
├─ README.md
└─ docs/
   ├─ ARCHITECTURE.md            # this file
   ├─ PRODUCT_SPEC.md
   ├─ BUILD_PLAN.md
   └─ PROMPTS.md
```

> ⏳ **Planned, not yet present:** `lib/client/supabase.ts` (browser supabase-js), `lib/server/claude.ts` + `lib/server/supabase-admin.ts`, `lib/prompts/` (Claude prompts P1–P6), `supabase/migrations/` (SQL + RLS), and the `app/play/[gameId]`, `app/c/[slug]`, `app/leaderboard` routes. There is currently **no** `@supabase` or `@anthropic-ai` dependency in `package.json`.

**Conventions:**

- `app/api/*/route.ts` route handlers and inline server actions are the *only* code that reads provider secrets.
- `lib/server/*` is the shared implementation those handlers call; it is server-only by construction and never reaches a `"use client"` module.
- ⏳ Planned: `lib/client/supabase.ts` will be the single browser Supabase entry point and touch only `NEXT_PUBLIC_*`.
- ⏳ Planned: `lib/prompts/*` will hold the strict-JSON Claude prompts; their full text lives in [PROMPTS.md](./PROMPTS.md). Today, host banter is templated, non-LLM strings in `lib/game/host-banter.ts`.

---

## 4. End-to-End Data Flow for One Round

> ⏳ **Planned target.** This section describes the intended Claude- and Supabase-backed round flow. It is **not** how the current build works: there is no `/api/round` route, no Claude call, and no Supabase `rounds`/`scores` persistence. Today, rounds come from `lib/session/mini-games.ts`, answer checking is server-side in `/api/rounds/check` and `/api/rounds/finish-line`, and live session state is held in the in-memory store (§5).

A round is *generated live and shown transiently*. The database stores only references — `track_id`, `line_index`, `round_type`, and a `seed` — never lyric text. The actual prompt/options/answer are rebuilt at play time from a live Musixmatch fetch plus Claude. This is the compliance backbone of the whole system.

### Sequence

```
Browser (play screen)        Next.js server (proxy)            Providers / Supabase
        │                            │                                  │
   1.   │ POST /api/round            │                                  │
        │ { gameId, position } ─────►│                                  │
        │                            │ 2. read round REFERENCE row      │
        │                            │    (track_id, line_index,        │
        │                            │     round_type, seed) ──────────►│ Supabase (rounds)
        │                            │◄─────────────────────────────────│
        │                            │ 3. fetch lyrics LIVE             │
        │                            │    track.lyrics.get / subtitle / │
        │                            │    richsync (MXM_KEY) ──────────►│ Musixmatch
        │                            │◄───────────────────────────────  │ full lyrics + copyright
        │                            │ 4. Claude builds the round       │
        │                            │    (P1/P2/P3, strict JSON,        │
        │                            │     model claude-opus-4-8) ─────►│ Claude
        │                            │◄───────────────────────────────  │ {prompt, options, answer}
        │                            │ 5. assemble runtime Round        │
        │◄── Round (transient) ──────│    (+ copyright string)          │
        │                            │                                  │
   6.   │ render mode component,     │                                  │
        │ show CopyrightBadge,       │                                  │
        │ fire MXM tracking pixel    │                                  │
        │                            │                                  │
   7.   │ player answers; timer      │                                  │
        │ gives speed bonus          │                                  │
        │                            │                                  │
   8.   │ write score ──────────────────────────────────────────────► │ Supabase (scores)
        │ (supabase-js, RLS, or via server for authoritative scoring)  │
        │                            │                                  │
   9.   │ optional: POST /api/host   │ Claude banter (P6) → ElevenLabs  │
        │ for emcee line + TTS ─────►│ TTS (correct/wrong/reveal) ─────►│ Claude + ElevenLabs
        │◄── host text + audio ──────│                                  │
```

### The runtime Round shape (generated live, NOT persisted with text)

This is the canonical TypeScript shape returned by `POST /api/round` and consumed by the mode components. It carries the lyric-derived `prompt`/`options`/`answer` only in memory and only for the duration of the round.

```ts
type RoundType =
  | "finish_line"
  | "the_drop"
  | "next_line"
  | "artist_pick"
  | "word_rush"
  | "name_song";

interface Round {
  id: string;
  gameId: string;
  trackId: string;
  lineIndex?: number;
  type: RoundType;
  prompt: string;
  options?: string[];
  answer: string;
  drop?: FinishLineDrop;
  timeLimitMs: number;
  copyright: string;
}
```

`copyright` is the Musixmatch `lyrics_copyright` string. The client must display it (via `CopyrightBadge`) and fire the Musixmatch tracking pixel/script whenever lyrics are shown.

### What gets persisted vs. what stays transient

| Field | Persisted? | Where |
|---|---|---|
| `track_id`, `line_index`, `round_type`, `seed` | Yes (reference only) | `rounds` table |
| `prompt`, `options`, `answer` (lyric-derived text) | **No — regenerated live** | In-memory `Round` only |
| `copyright` string | No (re-fetched with the lyrics) | Shown transiently |
| Player result (`points`, `accuracy`, `mode`) | Yes | `scores` table |

Because the answer text is never stored, the server reconstructs each playable
round from a track reference, a mini-game type, and a seed via a live Musixmatch
fetch plus deterministic server-side round logic. No lyric text changes hands
through persistence.

### Why Claude derives mood/theme (⏳ Planned)

`track.lyrics.mood.get` returns **403 FORBIDDEN** on our Musixmatch key. The planned mitigation is a `POST /api/mood` route (not yet built) that sends the full lyrics (which *are* available — `track.lyrics.get` returns 200 with full, non-truncated text) to Claude (prompt **P4**) and gets back a strict-JSON mood/theme classification. Lyric text used in P4 is transient — never logged, never stored.

---

## 5. Shared-Room Flow

Current Soundclash is a Jackbox-style shared room:

- `/host/new` creates a session.
- `/host/[code]` is the TV/stage screen.
- `/join` binds a phone to the room.
- `/player/[code]` is the phone controller.
- `POST /api/sessions/[code]/round` starts or auto-advances a round.
- `PATCH /api/sessions/[code]/round` submits a player answer.
- `PATCH /api/sessions/[code]` reveals results or returns to lobby.

The current implementation uses a server-side in-memory store for the active
session. The target implementation is Supabase Realtime Broadcast/Presence plus
reference-only persistence for sessions, players, rounds, answers, and scores.

### Future async challenge extension

Async challenge links remain a future social loop: play a set, share a slug, and
friends replay the same reference set later. This should reuse the same
references-only rule: share `track_id`, `round_type`, `seed`, and position, never
lyric text.

### How it works (⏳ Planned — `/api/challenge`, `/c/[slug]`, and Supabase below do not exist yet)

```
  Challenger                    Server                         Friend (later)
      │                           │                                 │
 1.   │ finishes a game           │                                 │
      │                           │                                 │
 2.   │ POST /api/challenge ─────►│ insert challenges row:          │
      │ { gameId }                │  game_id, challenger,           │
      │                           │  share_slug (unique), expires_at│──► Supabase
      │◄── { share_slug } ────────│                                 │
      │                           │                                 │
 3.   │ shares /c/<share_slug>    │                                 │
      │ ───────────────────────────────────────────────────────────►│ opens link
      │                           │                                 │
 4.   │                           │ /c/[slug] resolves slug →       │◄── GET (supabase-js, RLS)
      │                           │ challenge → game_id → the SAME  │
      │                           │ round references (track_id,     │
      │                           │ line_index, round_type, seed)   │
      │                           │                                 │
 5.   │                           │ friend plays: each round is     │
      │                           │ REBUILT LIVE from references    │
      │                           │ (fetch + Claude, same seed) ───►│ identical rounds
      │                           │                                 │
 6.   │                           │ friend's score written with     │
      │                           │ challenge_id → leaderboard      │──► Supabase (scores)
      │                           │ comparison on the same rounds   │
```

### Key properties

- **Same rounds, reconstructed — not redistributed.** The challenge stores `game_id` and a unique `share_slug`; it does **not** store lyric text. The friend's client hits the *same round references*, and the server rebuilds each round live (same `seed` → deterministic Claude output). No lyric text travels through the shared link. This satisfies the "no redistribution of lyric text in shared challenges" compliance rule.
- **Anonymous play allowed.** A challenge guest can play without an account: their result is written to `scores` with `anon_name` (no `player_id`). Authenticated users play via their `profiles` row. RLS distinguishes the two.
- **Expiry.** `challenges.expires_at` lets a challenge lapse; resolution of `/c/[slug]` checks it.
- **Leaderboards.** Global and daily leaderboards are plain Supabase reads against `leaderboard_global` (top scores joined to display names). Comparison "did my friend beat me" is just two `scores` rows sharing a `challenge_id` — no live coordination needed.

Because comparison is asynchronous and read-time, the system needs no realtime infrastructure at all — a deliberate scope decision for a 5-day build.

---

## 6. Data Model (Supabase / Postgres) — ⏳ Planned

> ⏳ **Planned target, not built.** There is no Supabase project, no `supabase/migrations/` directory, and no `@supabase` dependency in the current build. The schema below is the intended persistence layer; today the only "store" is the in-memory session store in `lib/server/session-store.ts`.

References-only by design. RLS enabled on every table. These are the canonical *planned* definitions — the executable SQL plus policies under `supabase/migrations/` does not exist yet.

```sql
-- profiles: one row per authenticated user
create table profiles (
  id            uuid primary key references auth.users,
  display_name  text,
  host_persona  text default 'hype',
  created_at    timestamptz default now()
);

-- games: a created game with a mode and config
create table games (
  id          uuid primary key default gen_random_uuid(),
  mode        text check (mode in ('finish_line','the_drop','next_line','artist_pick','word_rush','name_song','karaoke')),
  created_by  uuid references profiles,
  config      jsonb,
  created_at  timestamptz default now()
);

-- rounds: REFERENCES ONLY — no lyric-text columns
create table rounds (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid references games on delete cascade,
  track_id      text not null,
  line_index    int,
  round_type    text,
  seed          int,
  time_limit_ms int default 15000,
  position      int
);

-- challenges: async share links
create table challenges (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid references games,
  challenger  uuid references profiles,
  share_slug  text unique not null,
  expires_at  timestamptz,
  created_at  timestamptz default now()
);

-- scores: results (authed via player_id, anonymous via anon_name)
create table scores (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid references games,
  challenge_id  uuid references challenges,
  player_id     uuid references profiles,
  anon_name     text,
  points        int default 0,
  accuracy      numeric,
  mode          text,
  created_at    timestamptz default now()
);

-- leaderboard_global: top scores joined to display names
-- (view; RLS enabled on every underlying table)
```

The `rounds` table is intentionally text-free: it stores the reference quadruple (`track_id`, `line_index`, `round_type`, `seed`) that lets any round be reconstructed live, and nothing that would constitute stored or redistributed lyrics.

---

## 7. State Management

The state strategy follows the server-authoritative nature of the game. There is no global client store. Today, host/player sync is **~1s HTTP polling against the in-memory session store** (rows tagged ⏳ Planned describe the target Supabase model, not what runs now).

| State | Lives where | Why | Status |
|---|---|---|---|
| Round content (`prompt`/`options`/`answer`) | Server-built, held in the play screen's React component state for the round's lifetime | Transient by compliance; never persisted, never lifted into a global store | Implemented (server-side answer regen) |
| Live session (host/players/current round) | `lib/server/session-store.ts` (in-memory Map), polled ~1s by clients | Smallest path to a shared room with no infra | Implemented |
| Current game progress (which `position`, score so far) | React component state in the player/host screens | A single-flow game; local `useState`/`useReducer` is sufficient | Implemented |
| Timer / speed-bonus countdown | Local component state | UI-only, per-round | Implemented |
| Selected host persona | `profiles.host_persona` (authed) or local state (guest) | Persona is a small, durable preference | ⏳ Planned (DB side) |
| Scores, challenges, leaderboards | Supabase (server of record) | Durable, queried at read-time; RLS-guarded | ⏳ Planned |
| Auth session | supabase-js (browser) + cookie-bridged to server for server actions | Standard Supabase Auth/SSR pattern | ⏳ Planned |

**Principles:**

- **Server is authoritative for anything that counts.** Round generation and scoring happen on the server so neither the round answer nor the score can be tampered with from the client. The client renders and reports interactions; it does not own the truth.
- **No global client state library.** A Jackbox/Kahoot-style single-flow game doesn't need Redux/Zustand. Local component state plus server fetches keeps the codebase small for a 5-day build.
- **Fetch, don't subscribe.** Leaderboards and challenge comparisons are read on demand (page load / refresh), consistent with the no-realtime design.
- ⏳ Planned: **Supabase as the only persistent store**, accessed directly from the browser through the publishable key + RLS for reads/writes the user is allowed to make, and through a server-side service-role client only when a write must be authoritative (e.g. server-validated scoring). Until then, there is no persistence — session state lives only in the in-memory store and is lost on restart.

---

## 8. Tech-Choice Rationale

| Choice | Why |
|---|---|
| **Next.js (App Router, TypeScript)** | Route handlers and server actions give us a first-class server tier in the same project as the UI — exactly what the proxy pattern needs. The `NEXT_PUBLIC_` convention makes the secret boundary explicit and enforceable. TypeScript lets the canonical `Round` shape be a real type shared across server and client. |
| **Tailwind** | Fast, consistent styling for a game UI under a 5-day deadline; no separate design system to build. |
| **Supabase (Postgres + Auth + RLS)** — ⏳ Planned | One managed service covers the database, authentication, and authorization. RLS lets the browser talk to the DB directly with the publishable key without trusting the client — the database enforces who can read/write what. Anonymous challenge guests (`anon_name`) and authed players (`profiles`) coexist under one policy model. *Not yet adopted: no `@supabase` dependency; persistence is currently the in-memory session store.* |
| **Anthropic Claude (`claude-opus-4-8`)** — ⏳ Planned | Intended to drive live round generation (P1–P3), the mood/theme analysis that replaces the 403 Musixmatch endpoint (P4), and the host persona + banter (P5–P6), all returning strict JSON, called server-side via `@anthropic-ai/sdk` so `ANTHROPIC_API_KEY` never reaches the browser. *Not yet adopted: no `@anthropic-ai/sdk` dependency. Host banter currently uses localized string templates in `lib/game/host-banter.ts` (not an LLM); rounds come from `lib/session/mini-games.ts`.* |
| **ElevenLabs (TTS)** | The AI emcee's voice. Verified working: `POST /v1/text-to-speech/{voice_id}` returns `200 audio/mpeg`, auth via the `xi-api-key` header, on the creator tier (~131k credits). Selectable personalities map to different voices/prompts. Called only server-side. |
| **Musixmatch (lyrics)** | The sponsor API and the heart of the game. Verified live: `track.search`, `track.lyrics.get` (full lyrics, not truncated), `track.subtitle.get` (line-level synced), `track.richsync.get` (word-level synced), and `matcher.track.get` all return 200. `track.lyrics.mood.get` is 403 on our key — handled by deriving mood with Claude. Heavy Musixmatch use directly serves the "Use of Musixmatch API" judging criterion. |
| **LALAL.AI (optional)** | Stem separation for the karaoke stretch goal (vocal stem for pitch tracking), or the developer's own Soundberry stem service as an alternative. Optional and server-side only. |
| **Replit (deploy)** | Gives a public demo URL with the same env vars re-entered as Secrets — the brief's chosen host. |
| **No realtime layer** | A deliberate non-choice: the shared room is kept in sync with ~1s HTTP polling against the in-memory store, and the planned async `share_slug` model needs no sockets/presence — removing an entire class of infrastructure from a solo 5-day build (see §5). (Supabase Realtime is a possible later upgrade.) |

### Compliance constraints that shaped the architecture

These are not optional and are the reason the data model and round flow look the way they do:

- **Persist only references** — `rounds` stores `track_id` + `line_index` + `round_type` + `seed`; prompt/options/answer text is regenerated live and shown transiently.
- **No redistribution of lyric text** in shared challenges — the `share_slug` carries a `game_id`, not lyrics; rounds are rebuilt live for each player.
- **Display the Musixmatch `lyrics_copyright` and fire the tracking pixel/script** whenever lyrics are shown — enforced in the client via `CopyrightBadge`.
- **Non-commercial demo use only.**
- **Rotate** the ElevenLabs key and Supabase DB password before the public demo (some keys were pasted in chat during development).

---

## Related Documents

- [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) — product vision, game modes, player experience, judging mapping.
- [BUILD_PLAN.md](./BUILD_PLAN.md) — the day-by-day 5-day build schedule and risk register.
- [PROMPTS.md](./PROMPTS.md) — the full Claude prompts (P1 round generator, P2 misheard decoys, P3 name-that-song decoys, P4 mood/theme, P5 host system prompt, P6 host banter), all returning strict JSON.
