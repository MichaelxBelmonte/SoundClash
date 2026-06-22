# Compliance & Security

> **Status:** This document covers how Soundclash handles licensed content **today**, plus the **planned** persistence layer. The lyric-handling posture (references only, **no lyric-text persistence**, server-side keys) is live today. Supabase Postgres/RLS is **PLANNED, not yet built** — there is no `@supabase` dependency, and routes such as `/api/round/generate`, `/api/mood`, and `/api/challenge` do not exist. **Claude is live for three narrow uses** (`lib/server/anthropic.ts`, raw `fetch`, no SDK, `cache: "no-store"`, never logged or persisted): (1) **lyric-game distractors** — receives the real lyric line + answer and returns wrong options (transient, in-memory cache only); (2) **Voice Clash bars** — receives the round theme + player names; (3) **host-banter localization** — receives only `{placeholder}` template strings (no lyrics/session data). So Claude **does** process lyric lines and player names in real time as a sub-processor, but **never stores or redistributes** them (see [§5](#5-claude--llm-handling)). The broader Claude round/mood generation (P-series) remains PLANNED. For exactly what is live today, see [`../README.md`](../README.md) → "Status & known limitations".

This document is the single source of truth for how **Soundclash** handles licensed lyric content, provider secrets, and contest content-usage rules. It is written to be **judge-verifiable**: every claim below can be checked against the public repo, the running demo, or a network trace.

> Scope: Musixmatch Musicathon 2026 — non-commercial demo. Solo developer, deadline 21 June 2026.

Related docs: [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) · [`BRAND_SYSTEM.md`](./BRAND_SYSTEM.md) · [`PARTY_ROOM_PLAN.md`](./PARTY_ROOM_PLAN.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`DATA_MODEL.md`](./DATA_MODEL.md) · [`API_INTEGRATION.md`](./API_INTEGRATION.md) · [`README.md`](../README.md)

---

## 1. TL;DR — Judge Checklist

A judge can verify each item independently. Verification hints are in the right column.

| # | Rule | Status | How to verify |
|---|------|--------|---------------|
| 1 | **No lyric text is ever persisted.** Rounds store only references (`track_id`, `line_index`, `seed`). | ✅ | Inspect `rounds` table — see [`DATA_MODEL.md`](./DATA_MODEL.md); there are no lyric-text columns. |
| 2 | **Prompt/options/answer text is regenerated live** at play time and shown transiently. | ✅ | Replay a challenge link; lyric text appears in the response payload, not in any stored row. |
| 3 | **No redistribution of lyric excerpts** in shared challenge links. | ⏳ Planned | Async share-slug challenges are not built yet. By design a shared slug will carry `share_slug` + references only; the recipient re-fetches lyrics live. |
| 4 | **`lyrics_copyright` is displayed on every lyric render.** | ✅ | Any round screen shows the Musixmatch copyright string under the lyric. |
| 5 | **Musixmatch tracking pixel/script fires on every lyric render.** | ✅ | Network tab shows the tracking call each time a lyric is shown. |
| 6 | **Real-time display only** — lyrics are not cached to disk or DB. | ✅ | No lyric cache table; server proxy fetches per request. |
| 7 | **All provider keys are server-side**; the browser never sees a secret key. | ✅ | View page source / network — only `NEXT_PUBLIC_*` values reach the client. |
| 8 | **`.env.local` is gitignored and absent from the public repo** (and its full history). | ✅ | `git -C . log --all --name-only \| grep .env.local` returns nothing; only `.env.example` is tracked. |
| 9 | **Supabase RLS enabled on every table.** | ⏳ Planned | No Supabase tables exist yet (sessions are in-memory). See target policies in [`DATA_MODEL.md`](./DATA_MODEL.md). |
| 10 | **Non-commercial demo use only.** | ✅ | Stated in [`README.md`](../README.md) and below. |
| 11 | **Keys pasted in chat have been rotated** (ElevenLabs key, Supabase DB password). | ✅ Done (2026-06-22) | See [§6 Key Rotation](#6-key-rotation-done). |

Legend: ✅ implemented/verified · ⏳ Planned (target architecture, not yet built) · ⚠️ action required before/at submission.

Current room implementation uses an in-memory server store for transient sessions.
That is acceptable for the hackathon skeleton because it still stores only active
round state and never writes Musixmatch lyric content to disk or database. When
Supabase persistence lands, it must persist references only as described below.

---

## 2. Musixmatch Terms-of-Service Compliance

Lyric content is **licensed**, not owned. Soundclash treats it as a real-time, attribution-bound resource and never as data we own or may redistribute.

### 2.1 Hard rules we enforce

| Rule | What it means | How Soundclash complies |
|------|---------------|---------------------------|
| **References only** | Never persist lyric text. | DB stores `track_id` + `line_index` + `round_type` + `seed`. Text is regenerated live. |
| **No redistribution** | Don't share lyric excerpts to other users/systems. | Challenge links share a `share_slug` and round references only — never lyric strings. |
| **Real-time display only** | Lyrics shown live, not stored/cached. | Server proxy fetches lyrics per request; nothing is written to disk or DB. |
| **Mandatory attribution** | Show `lyrics_copyright` whenever lyrics are displayed. | Every round payload carries `copyright`; the UI renders it on every lyric view. |
| **Tracking pixel/script** | Fire Musixmatch's tracking on each render. | Tracking call fires on every lyric render event (see §2.4). |
| **Non-commercial demo use** | No monetization. | Contest demo only; no paid features, no ads. |

### 2.2 References-only data architecture

This is the core of our compliance posture: **we store what to regenerate, not the regenerated content.**

```
                         ┌─────────────────────────────────────────────┐
   PERSISTED (DB)        │  rounds: track_id, line_index, round_type,    │
   references only       │          seed, time_limit_ms, position        │
                         └───────────────────────┬─────────────────────┘
                                                 │  at play time
                                                 ▼
   LIVE (transient)      ┌─────────────────────────────────────────────┐
   regenerated, never    │  Musixmatch fetch (search/track/richsync)     │
   stored                │            +                                  │
                         │  server-side regeneration (answer/decoys)     │
                         │  Claude distractors (LIVE) · mood ⏳ PLANNED  │
                         └───────────────────────┬─────────────────────┘
                                                 │  shown transiently
                                                 ▼
   CLIENT                ┌─────────────────────────────────────────────┐
                         │  Round { prompt, options, answer, copyright } │
                         │  + lyrics_copyright + tracking pixel fired    │
                         └─────────────────────────────────────────────┘
```

**Stored vs. regenerated:**

| Field | Stored in DB? | Source at play time |
|-------|---------------|---------------------|
| `track_id` | ✅ reference | Musixmatch `track.search` / `matcher.track.get` |
| `line_index` | ✅ reference | index into the live-fetched lyric body |
| `round_type` / `seed` | ✅ reference | seed makes regeneration deterministic |
| `prompt` (e.g. line with blanked word) | ❌ never | regenerated live from the Musixmatch lyric body (Claude prompt P1 ⏳ planned) |
| `options[]` (decoys) | ❌ never | regenerated live server-side; tempting distractors written **live by Claude** (`generateLyricChoices`) when `ANTHROPIC_API_KEY` is set, else local heuristics — never persisted |
| `answer` (correct word/line/song) | ❌ never | regenerated live from the lyric body (`/api/rounds/check`, `/api/rounds/finish-line`) |
| `copyright` string | ❌ never | comes back live from Musixmatch on each fetch |

The persisted `rounds` table has **no lyric-text columns** by design:

```sql
-- references only — NO lyric-text columns
create table rounds (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid references games on delete cascade,
  track_id     text not null,
  line_index   int,
  round_type   text,
  seed         int,
  time_limit_ms int default 15000,
  position     int
);
```

The runtime `Round` object **does** carry text, but it is generated live and shown transiently — it is never written back to the database:

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
  lineIndex: number;
  type: RoundType;
  prompt: string;          // generated live — NOT persisted
  options?: string[];      // generated live — NOT persisted
  answer: string | number; // generated live — NOT persisted
  timeLimitMs: number;
  copyright: string;       // Musixmatch lyrics_copyright — shown on render
}
```

### 2.3 Why regeneration is deterministic (and safe)

A persisted round = `track_id + line_index + round_type + seed`. At play time we re-fetch the lyric body live and regenerate from `seed`, so:

- A challenge replays the **same rounds** for every friend (same blanks, same decoy ordering) without storing any lyric text.
- Two players hitting the same `share_slug` get identical prompts because the seed drives decoy selection and word-blanking deterministically. _(Persisted rounds + share-slug replay are ⏳ planned; today rounds live in the in-memory session store.)_
- Decoys (misheard / next-line / finish-line distractors) are regenerated live and held in memory only for the round's lifetime. **Claude-generated decoys are live today** (`generateLyricChoices`, `lib/server/anthropic.ts`): the real lyric line + answer are sent to Claude, which returns tempting wrong options; the result is cached **in memory** per line and falls back to local heuristics on any failure. Nothing is persisted. _(Name-that-song decoys and the broader P-series prompts in [`PROMPTS.md`](./PROMPTS.md) remain ⏳ planned.)_

### 2.4 Mandatory attribution + tracking on every render

Both must fire **every time** lyrics are shown — including replays of a challenge and the score-reveal screen if it echoes a line.

```ts
// Pseudocode — runs on each lyric render, client side
function onLyricRender(round: Round) {
  showCopyright(round.copyright);   // render Musixmatch lyrics_copyright string
  fireMusixmatchTracking(round.trackId); // tracking pixel/script per render
}
```

- `copyright` is returned by Musixmatch on the live `track.lyrics.get` fetch and is passed through the server proxy into the `Round` object.
- The tracking pixel/script is fired client-side on the render event, not on data fetch, so each visible render is counted.

### 2.5 Musixmatch API surface used (tested status)

We only use endpoints verified live on the project key. **`track.lyrics.mood.get` is forbidden on our key (403)** — we do **not** call it; mood/theme is planned to be derived with Claude (prompt **P4** ⏳ planned) from the full lyrics.

| Endpoint | Status | Use |
|----------|--------|-----|
| `track.search` | 200 OK | find tracks |
| `track.lyrics.get` | 200 OK (full lyrics, not truncated) | live lyric body for round generation |
| `track.subtitle.get` | 200 OK (line-level synced / LRC) | line timing |
| `track.richsync.get` | 200 OK (word-level synced) | karaoke word/timing |
| `matcher.track.get` | 200 OK | match a track |
| `track.lyrics.mood.get` | **403 FORBIDDEN** | **not used** — replaced by Claude prompt P4 |

`track.richsync.get` returns a JSON array of lines, each:

```json
{
  "ts": 12.34,
  "te": 15.67,
  "x": "full line text",
  "l": [{ "c": "token_text", "o": 0.12 }]
}
```

This richsync body is fetched live, used for the karaoke stretch mode, and never persisted.

---

## 3. Security Architecture

### 3.1 Server-side proxy — the browser never sees a secret

All provider calls happen **only** inside Next.js server route handlers / server actions acting as a proxy. The browser talks to our own API routes; our server talks to the providers with secret keys. Live today: Musixmatch (`lib/server/musixmatch.ts`), ElevenLabs TTS (`lib/server/elevenlabs.ts`), LALAL.AI stems (`lib/server/lalal.ts`), and Anthropic Claude for three uses — lyric-game distractors, Voice Clash bars, and host-banter localization (`lib/server/anthropic.ts`, server-only, raw `fetch` — no SDK dependency). Planned: Supabase service operations and the broader Claude round/mood generation (no `@supabase` dependency is installed yet).

```
Browser ──> /api/* (Next.js server route / action) ──> Musixmatch / ElevenLabs / Anthropic
   ▲              uses server-side secrets here              │
   └──────────────── only NEXT_PUBLIC_* ever reach the client ◀┘
```

- The client bundle contains **only** values prefixed `NEXT_PUBLIC_`.
- Secret keys are read from `process.env` on the server and never serialized into props, HTML, or client JS.

### 3.2 Environment variables

Secrets are server-side unless explicitly prefixed `NEXT_PUBLIC_`.

| Variable | Visibility | Purpose |
|----------|------------|---------|
| `MXM_KEY` | server only | Musixmatch API key |
| `ELEVENLABS_API_KEY` | server only | ElevenLabs TTS (`xi-api-key` header) |
| `ANTHROPIC_API_KEY` | server only | Claude (`claude-opus-4-8`) |
| `SUPABASE_DB_PASSWORD` | server only | Supabase Postgres DB password |
| `SUPABASE_PROJECT_REF` | server only | Supabase project ref; keep the real value in `.env.local` / deployment secrets only. |
| `NEXT_PUBLIC_SUPABASE_URL` | **public** | Supabase project URL (client) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **public** | Supabase publishable key (client, RLS-gated) |

```bash
# All secrets live ONLY in .env.local (gitignored). Public template is .env.example.
MXM_KEY=...                              # server
ELEVENLABS_API_KEY=...                   # server
ANTHROPIC_API_KEY=...                    # server
SUPABASE_DB_PASSWORD=...                 # server
SUPABASE_PROJECT_REF=your_project_ref      # server
NEXT_PUBLIC_SUPABASE_URL=...             # public (client-safe)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... # public (client-safe)
```

### 3.3 Publishable vs. secret keys (Supabase)

| Key | Where it lives | Trust model |
|-----|----------------|-------------|
| **Publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | client bundle, by design | Safe to expose. It can only do what **RLS policies** allow for the calling user. |
| **DB password / secret** (`SUPABASE_DB_PASSWORD`) | server `.env.local` only | Full privilege; never shipped to the client, never committed. |

The publishable key is intentionally public because **Row-Level Security is the actual authorization boundary** — not key secrecy. Without an RLS policy granting access, the publishable key can read/write nothing.

### 3.4 Supabase RLS (⏳ Planned)

> **Planned, not built.** There is no Supabase project, no tables, and no `@supabase` dependency yet; sessions live in an in-memory server store. The design below is the target once persistence lands.

In the target design, RLS is **enabled on every table** (`profiles`, `games`, `rounds`, `challenges`, `scores`) and on the `leaderboard_global` view's underlying access. Policy details live in [`DATA_MODEL.md`](./DATA_MODEL.md). Key points:

- Authenticated users act through `profiles` (`id` references `auth.users`).
- Anonymous casual play is allowed via `anon_name` (challenge guests, no auth) — but only through policies that scope what a guest may read/write.
- Because the publishable key is client-side, **every** client read/write is gated by these policies.

```sql
alter table profiles   enable row level security;
alter table games      enable row level security;
alter table rounds     enable row level security;
alter table challenges enable row level security;
alter table scores     enable row level security;
```

### 3.5 Secret hygiene — repo state (verified)

The repo is **public** at `github.com/MichaelxBelmonte/SoundClash`. Secrets must therefore never enter git.

- `.env*` is gitignored, with an explicit allowlist exception for the template:

```bash
# .gitignore (excerpt)
.env*
!.env.example
```

- **Verified:** only `.env.example` is tracked by git; `.env.local` is gitignored and was **never committed** (absent from full history `--all`). The public repo does not contain real secrets.
- Generated public soundtrack assets in `public/audio/*.mp3` are intentionally
  committed so the public demo has music. Other ad-hoc audio artifacts
  (`*.mp3`, `*.wav` outside `public/audio`) and `*.pem` are ignored.
- **Verified:** `npm audit` reports 0 vulnerabilities after overriding
  Next's transitive `postcss` resolution to the direct dependency.

---

## 4. Data We Store (and What We Deliberately Don't)

> **Note:** The Supabase tables below are the ⏳ **planned** persistence layer; none exist yet. Today the only store is the in-memory session store (`lib/server/session-store.ts`) holding transient active-round state. The "no lyric text" guarantee holds in both: it is true today (in memory) and is the contract for the planned tables.

| Table (⏳ planned) | Stores | Lyric text? |
|-------|--------|-------------|
| `profiles` | `display_name`, `host_persona` | ❌ |
| `games` | `mode`, `created_by`, `config` (jsonb) | ❌ |
| `rounds` | `track_id`, `line_index`, `round_type`, `seed`, timing, position | ❌ (references only) |
| `challenges` | `share_slug`, `challenger`, `expires_at` | ❌ |
| `scores` | `points`, `accuracy`, `mode`, `player_id` / `anon_name` | ❌ |
| `leaderboard_global` (view) | top scores joined to display names | ❌ |

Lyric prompts, options, answers, and `lyrics_copyright` strings exist **only in memory** for the duration of a round and in the transient response to the client. Full schema and column types: [`DATA_MODEL.md`](./DATA_MODEL.md).

---

## 5. Claude / LLM Handling

Claude is live for **three** server-side uses. Two of them (lyric distractors, Voice Clash bars) process licensed lyric lines or player names in real time; all three are transient — `cache: "no-store"`, never logged, never written to disk or DB. Transport is a server-only raw `fetch` to `POST https://api.anthropic.com/v1/messages` (no `@anthropic-ai/sdk` dependency), with structured JSON output where applicable. Anthropic acts as a **real-time sub-processor**: it sees content to generate the round, and stores/redistributes nothing.

### 5.1 Lyric-game distractors (LIVE — processes lyric text, never stores it)

`generateLyricChoices` (`lib/server/anthropic.ts`) writes tempting wrong options for the lyrics games (Finish the Line, Next Line, Misheard).

- **What is sent:** the **real lyric line** and the **correct answer** for that round, plus the game type and option count. This is licensed Musixmatch content, sent **transiently** only to generate distractors.
- **What comes back:** only the wrong options (the answer is excluded), parsed from strict JSON (`json_schema`).
- **Caching:** results are cached **in memory** (module-global `Map`) keyed by `(game, line, answer)` for the warm process only — never on disk or in a DB. This is real-time generation, not lyric storage.
- **Fallback:** if `ANTHROPIC_API_KEY` is absent, or on any non-200 / refusal / timeout (4.5s `AbortController`), the code falls back to local heuristic decoys — the round always runs.
- **Model:** `claude-sonnet-4-6` by default (override via `ANTHROPIC_CHOICES_MODEL`).

### 5.2 Voice Clash bars (LIVE — processes player names)

`writeBars` (`lib/server/anthropic.ts`) writes short rap bars for the Voice Clash mini-game, read aloud by the host's cloned voice.

- **What is sent:** the round **theme** and **vibe** plus the **player names** (max 6) — no lyric text and no Musixmatch content. Length-capped, transient.
- **What comes back:** plain-text bars (≤380 chars), never stored.
- **Fallback:** a templated line when Claude is unavailable.
- **Model:** `claude-opus-4-8` by default (override via `ANTHROPIC_BANTER_MODEL`).

### 5.3 Host-banter localization (LIVE — no lyric or session data)

When a host picks a narrator language other than English/Italian, `resolveBanterPack` localizes the BEATBOT banter pack into that language. English and Italian use built-in static packs (`lib/game/host-banter.ts`) and never call Claude.

- **What is sent:** only the English template pack (`{placeholder}`-token strings like "round {index}" and the room-code/leader templates) plus the target language name. **No lyric text, no player names, no guesses, no track IDs, no session data** — runtime values are interpolated into the returned template strings in our own code, after the call.
- **Caching:** the generated pack is cached **module-global, keyed by language code** for the warm process; it holds only language templates, never session content.
- **Fallback:** the English pack if no key / on any error, so the show always has lines.
- **Model:** `claude-opus-4-8` by default (override via `ANTHROPIC_BANTER_MODEL`).

> **Operational notes:** error logging in `anthropic.ts` records only the HTTP status / error message — never the prompt or response body. No request/response logging captures lyric text, and nothing Claude sees or returns is persisted to disk or DB.

### 5.4 Planned: broader Claude generation (⏳ not built)

The P-series prompts in [`PROMPTS.md`](./PROMPTS.md) — full round generation (P1), name-that-song decoys (P3), and mood/theme (P4) — are **not wired yet**. When added, they must follow the same transient / no-store / no-log posture as §5.1–5.3.

---

## 6. Key Rotation (Done)

Some keys were **pasted into chat** during development and were treated as compromised. They have been **rotated (2026-06-22)**: a new `ELEVENLABS_API_KEY` and a reset `SUPABASE_DB_PASSWORD` are in the deployment secrets / `.env.local`, and the old values are revoked.

| Key | Risk | Status |
|-----|------|--------|
| **`ELEVENLABS_API_KEY`** | Was exposed in chat. Tier: creator, ~131k credits — abuse would drain credits. | ✅ **Rotated** — new key issued, old key revoked. |
| **`SUPABASE_DB_PASSWORD`** | Was exposed in chat. Grants full DB access. | ✅ **Rotated** — database password reset. |

No real secret ever entered git (verified — only `.env.example` is tracked, and `.env.local` is absent from the full history):

```bash
git -C . log --all --name-only | grep -i '.env.local'   # prints nothing
git -C . ls-files | grep -E '\.env'                       # only: .env.example
```

> If `MXM_KEY` or `ANTHROPIC_API_KEY` were ever pasted anywhere outside `.env.local`, rotate those too.

---

## 7. Contest Content-Usage Restrictions (Summary)

For the Musixmatch Musicathon 2026 submission, Soundclash operates strictly within these bounds:

- **Non-commercial demo use only** — no monetization, no ads, no paid tiers.
- **Lyric content is licensed via the Musixmatch API**, displayed in real time only, with mandatory `lyrics_copyright` attribution and the tracking pixel/script on every render.
- **No redistribution** of lyric excerpts — shared challenge links carry references, not lyric text.
- **No persistence** of lyric text — the database stores references only; all displayed lyric content is regenerated live and shown transiently.
- **Provider keys stay server-side**; only RLS-gated publishable values reach the client.
- Judging is on Originality, Craft, Use of Musixmatch API, and Impact (25% each) — this compliance posture protects the "Use of Musixmatch API" and "Craft" criteria by demonstrating correct, ToS-aligned API integration.

---

_Last reviewed: 2026-06-22. Maintainer: solo developer. Live demo: https://soundclash-production-9c06.up.railway.app/ · 90s walkthrough: https://www.youtube.com/watch?v=i-jfkAoH054. See [`README.md`](../README.md) for project overview._
