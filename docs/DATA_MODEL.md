# Data Model & Supabase Schema

> **Status — TARGET architecture, NOT yet built.** This document describes the *planned* persistence layer. The Supabase/Postgres schema (`profiles` / `games` / `rounds` / `challenges` / `scores`, the RLS policies, and the `leaderboard_global` view), the Claude round/text regeneration, and the share-slug challenge flow are all **PLANNED — not implemented**. There is no `@supabase` or `@anthropic-ai` dependency and no `supabase/` directory in the repo today.
> **What actually runs today** is an in-memory session store — `lib/server/session-store.ts` (a module-global `Map`, per-instance, no DB), with `PartySession` / `SessionRound` / `SessionPlayer` types and host↔player sync over ~1s HTTP polling. There is NO database and NO realtime service.
> For the live feature set and limitations, see [`../README.md`](../README.md) (its "Status & known limitations" section).

Soundclash persists scores, challenges, and leaderboards in Supabase (Postgres + Auth + RLS). This document is the canonical schema reference: ready-to-run DDL, Row Level Security policies, indexes, and the persisted-vs-runtime split that keeps the project compliant with Musixmatch terms.

Sibling docs:
- [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) — vision, game modes, scoring, judging map.
- [`BUILD_PLAN.md`](./BUILD_PLAN.md) — 5-day sequencing and de-risking notes.
- [`PROMPTS.md`](./PROMPTS.md) — the six Claude prompts (P1–P6) that regenerate round text live.
- [`COMPLIANCE.md`](./COMPLIANCE.md) — references-only rules, copyright display, tracking pixel.
- [`README.md`](../README.md) — stack, setup, and key-security notes.

---

## ⚠️ COMPLIANCE — references only, never lyric text (read first)

**NEVER store lyric text. A persisted round stores ONLY `track_id` + `line_index` + `round_type` + a `seed`. The actual prompt / options / answer TEXT is regenerated LIVE at play time (Musixmatch fetch + Claude) and shown transiently — never written to any table, log, or shared challenge.**

This is a hard rule, not a guideline. Everything in this schema is built around it:

- The `rounds` table has **no lyric-text columns** — no prompt, no options, no answer.
- Shared challenges (`challenges`) carry a `share_slug` and a pointer to a `game`; the friend who opens the slug re-fetches and re-generates the same rounds from the same references. **No redistribution of lyric text.**
- Whenever lyrics are shown to a user, the UI must display the Musixmatch `lyrics_copyright` string and fire the Musixmatch tracking pixel/script. See [`COMPLIANCE.md`](./COMPLIANCE.md).
- Non-commercial demo use only.

If a column would ever hold a lyric, a mondegreen decoy, or a correct answer string, it does not belong in Postgres — it belongs in the transient runtime `Round` object (see [Persisted vs runtime](#persisted-vs-runtime)).

---

## Schema overview

> ⏳ **Planned.** None of these tables exist yet — the runtime store keeps everything in memory (see status banner above).

| Table | Purpose | Holds lyric text? | Status |
|---|---|---|---|
| `profiles` | One row per authed user (extends `auth.users`); display name + host persona | No | ⏳ Planned |
| `games` | A configured game instance: mode + config + creator | No | ⏳ Planned |
| `rounds` | Ordered references to lyric lines (track_id + line_index + round_type + seed) | **No — by design** | ⏳ Planned |
| `challenges` | Async challenge: a `share_slug` linking friends to the same game/rounds | No | ⏳ Planned |
| `scores` | A player's result on a game (authed via `profiles`, or guest via `anon_name`) | No | ⏳ Planned |
| `leaderboard_global` (view) | Top scores joined to display names | No | ⏳ Planned |

RLS is enabled on every table. Anonymous casual play is allowed via `scores.anon_name` (challenge guests, no auth); authed users play via `profiles`.

---

## SQL DDL

Run this in the Supabase SQL editor or as a migration. It is idempotent-friendly where practical and ordered to satisfy foreign-key dependencies (`profiles` → `games` → `rounds`/`challenges`/`scores`).

```sql
-- ============================================================
-- Soundclash — schema (references only; NO lyric text)
-- ============================================================

-- profiles: extends auth.users with display name + host persona
create table if not exists profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  host_persona text default 'hype',
  created_at   timestamptz not null default now()
);

-- games: a configured game instance
create table if not exists games (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null check (mode in (
               'finish_line','the_drop','next_line','artist_pick','word_rush','name_song','karaoke'
             )),
  created_by uuid references profiles (id) on delete set null,
  config     jsonb,
  created_at timestamptz not null default now()
);

-- rounds: references ONLY — track_id + line_index + round_type + seed.
-- NO lyric-text columns (no prompt, no options, no answer). Text is
-- regenerated live at play time from these references.
create table if not exists rounds (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid references games (id) on delete cascade,
  track_id      text not null,
  line_index    int,
  round_type    text,
  seed          int,
  time_limit_ms int default 15000,
  position      int
);

-- challenges: async challenge link; friends replay the SAME game/rounds
create table if not exists challenges (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid references games (id) on delete cascade,
  challenger  uuid references profiles (id) on delete set null,
  share_slug  text unique not null,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- scores: a result. Authed players -> player_id; guests -> anon_name.
create table if not exists scores (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid references games (id) on delete cascade,
  challenge_id uuid references challenges (id) on delete set null,
  player_id    uuid references profiles (id) on delete set null,
  anon_name    text,
  points       int default 0,
  accuracy     numeric,
  mode         text,
  created_at   timestamptz not null default now()
);
```

### Leaderboard view

`leaderboard_global` joins top scores to display names and resolves a single label per row (authed `display_name`, else the guest `anon_name`, else a fallback). Ordering is points-first.

```sql
create or replace view leaderboard_global as
select
  s.id,
  s.game_id,
  s.challenge_id,
  s.mode,
  s.points,
  s.accuracy,
  s.created_at,
  coalesce(p.display_name, s.anon_name, 'Anonymous') as player_label,
  s.player_id is not null                            as is_authed
from scores s
left join profiles p on p.id = s.player_id
order by s.points desc, s.created_at asc;
```

> The view inherits the RLS of its underlying tables. Because `scores` is publicly readable (see below), the leaderboard reads fine from the browser via the publishable key. For a daily leaderboard, filter on `created_at >= date_trunc('day', now())` in the query or add a sibling view.

---

## Row Level Security (RLS)

Enable RLS on every table, then add policies. The model:

- **`profiles`** — anyone can read (needed to render display names on leaderboards); a user can insert/update only their own row.
- **`games`** — public read (challenge guests must load a game by id); authed users insert; creator updates.
- **`rounds`** — public read (guests replay the same references); writes are server-side only (no client write policy → the publishable/anon key cannot write rounds; the server uses an elevated context).
- **`challenges`** — public read (resolve a `share_slug` with no auth); authed challengers create.
- **`scores`** — public read (leaderboards); **anyone can insert** (authed players and anonymous challenge guests submitting via `anon_name`). Inserts are validated by a constraint, not blocked.

```sql
-- Enable RLS everywhere
alter table profiles   enable row level security;
alter table games      enable row level security;
alter table rounds     enable row level security;
alter table challenges enable row level security;
alter table scores     enable row level security;

-- ---------- profiles ----------
create policy "profiles: public read"
  on profiles for select
  using (true);

create policy "profiles: insert own"
  on profiles for insert
  with check (auth.uid() = id);

create policy "profiles: update own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------- games ----------
create policy "games: public read"
  on games for select
  using (true);

create policy "games: authed insert as creator"
  on games for insert
  with check (auth.uid() = created_by);

create policy "games: creator update"
  on games for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- ---------- rounds ----------
-- Public read so challenge guests can replay the same references.
-- No insert/update/delete policy => clients (anon/publishable key) cannot
-- write rounds. Round creation happens in the Next.js server proxy.
create policy "rounds: public read"
  on rounds for select
  using (true);

-- ---------- challenges ----------
create policy "challenges: public read by slug"
  on challenges for select
  using (true);

create policy "challenges: authed create"
  on challenges for insert
  with check (auth.uid() = challenger);

-- ---------- scores ----------
create policy "scores: public read"
  on scores for select
  using (true);

-- Anonymous guests AND authed players can submit a score.
-- Authed submissions must own player_id; guest submissions must carry an
-- anon_name and no player_id. Exactly one identity must be present.
create policy "scores: insert authed or anon guest"
  on scores for insert
  with check (
    (player_id is not null and auth.uid() = player_id)
    or
    (player_id is null and anon_name is not null and length(trim(anon_name)) > 0)
  );
```

### Why guest inserts are allowed but bounded

The whole social loop depends on a friend opening a `share_slug` and posting a score **without signing up**. RLS makes that safe without an open door:

- A guest row must have `anon_name` set and `player_id` null — it can never impersonate an authed user.
- An authed row must satisfy `auth.uid() = player_id` — a logged-in client cannot post under someone else's id.
- No `update`/`delete` policy on `scores` → submitted scores are immutable from the client (no leaderboard tampering after the fact).

> Rate-limiting and anti-spam for guest inserts are handled in the server proxy (and optionally a Postgres trigger), not in RLS. Keep that logic out of the publishable-key path.

---

## Indexes

The hot read paths are: leaderboards (scores ordered by points, optionally scoped to a game), and challenge resolution (look up a game by `share_slug`).

```sql
-- Leaderboards: top scores overall and per game
create index if not exists scores_points_desc_idx
  on scores (points desc, created_at asc);

create index if not exists scores_game_points_idx
  on scores (game_id, points desc);

-- Daily leaderboard scans
create index if not exists scores_created_at_idx
  on scores (created_at desc);

-- Challenge resolution: open a share link
-- (share_slug already has a UNIQUE constraint, which creates a btree index;
--  this explicit one documents intent and covers slug lookups.)
create index if not exists challenges_share_slug_idx
  on challenges (share_slug);

-- Replay a challenge's rounds in order
create index if not exists rounds_game_position_idx
  on rounds (game_id, position);

-- Foreign-key lookups used on join
create index if not exists scores_challenge_id_idx
  on scores (challenge_id);

create index if not exists games_created_by_idx
  on games (created_by);
```

---

## Persisted vs runtime

This is the architectural heart of the compliance rule. There are **two `Round` shapes** and they never overlap on the lyric text.

### Persisted round (Postgres `rounds` row)

References only. This is all that ever touches the database:

```json
{
  "id": "f3a1...uuid",
  "game_id": "9c0d...uuid",
  "track_id": "20581873",
  "line_index": 12,
  "round_type": "finish_line",
  "seed": 48273,
  "time_limit_ms": 15000,
  "position": 1
}
```

`track_id` is the Musixmatch track id, `line_index` selects the line within that track's synced lyrics, `round_type` is the game mode for the round, and `seed` makes decoy/mask generation deterministic — the same references always regenerate the same playable round.

### Runtime `Round` (transient, generated live, NOT persisted)

At play time the server proxy fetches the lyric for `track_id` + `line_index` from Musixmatch, calls Claude (see [`PROMPTS.md`](./PROMPTS.md), prompts P1–P3) seeded with `seed`, and assembles the playable round. This object carries the prompt, options, and answer — and is shown to the player transiently, then discarded. It is **never written back** to any table.

```ts
type RoundType =
  | 'finish_line'
  | 'the_drop'
  | 'next_line'
  | 'artist_pick'
  | 'word_rush'
  | 'name_song';

interface Round {
  id: string;            // matches the persisted rounds.id
  gameId: string;        // rounds.game_id
  trackId: string;       // rounds.track_id (Musixmatch track id)
  lineIndex: number;     // rounds.line_index
  type: RoundType;       // rounds.round_type
  prompt: string;        // GENERATED LIVE — never persisted
  options?: string[];    // GENERATED LIVE (multiple-choice modes) — never persisted
  answer: string | number; // GENERATED LIVE — never persisted
  timeLimitMs: number;   // rounds.time_limit_ms
  copyright: string;     // Musixmatch lyrics_copyright — must be displayed
}
```

### The flow

```
rounds row (references)  ──fetch──►  Musixmatch lyric line(s)
        │                                     │
        │                                     ▼
        └──────────────────►  Claude (P1–P3, seeded)  ──►  runtime Round
                                                              │
                                          shown to player ◄───┘ (transient)
                                                              │
                                          discarded ──────────┘ (never persisted)
```

The `copyright` field on the runtime `Round` carries the Musixmatch `lyrics_copyright` string so the UI can display it and fire the tracking pixel whenever the lyric is shown ([`COMPLIANCE.md`](./COMPLIANCE.md)). Scoring the player's answer writes only to `scores` — `points`, `accuracy`, `mode`, and an identity (`player_id` or `anon_name`). Never the answer text.

> **`RoundType` vs `mode`:** the runtime `RoundType` union omits `karaoke` (karaoke is a pitch/timing stretch mode, scored differently and not a text-options round). The `games.mode` CHECK constraint includes `karaoke` because a game can *be* a karaoke game; the persisted `rounds.round_type` for the MVP word games is one of the five `RoundType` values.

---

## Server-side access and key safety

All provider calls happen **only** in the Next.js server (route handlers / server actions) acting as a proxy — the browser never sees server-side secrets. Today this covers Musixmatch (`/api/mxm/*`), ElevenLabs (`/api/host/speak`), and LALAL.AI (`/api/lalal/*`). The Claude calls and any privileged DB write (e.g. inserting `rounds`) below are ⏳ **Planned** — Claude integration and the Supabase tables are not built yet.

Environment variables (server-side secrets unless prefixed `NEXT_PUBLIC`):

| Var | Scope | Used for | Status |
|---|---|---|---|
| `MXM_KEY` | server | Musixmatch API | Live |
| `ELEVENLABS_API_KEY` | server | ElevenLabs TTS (`xi-api-key` header) | Live |
| `LALAL_API_KEY` | server | LALAL.AI stem separation | Live |
| `ANTHROPIC_API_KEY` | server | Claude (`claude-opus-4-8`) | ⏳ Planned (no `@anthropic-ai` dep; host banter is string templates, not an LLM) |
| `SUPABASE_DB_PASSWORD` | server | Migrations / privileged DB access | ⏳ Planned |
| `SUPABASE_PROJECT_REF` | server | Supabase project reference; keep the real value in `.env.local` / deployment secrets only. | ⏳ Planned |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Browser Supabase client | ⏳ Planned |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Browser Supabase client (RLS-bounded) | ⏳ Planned |

The publishable key reaches the client and is bound by the RLS policies above — it can read leaderboards and insert a guest/own score, but cannot write `rounds` or mutate other users' data. Secrets live only in `.env.local` (gitignored); the repo is public at `github.com/MichaelxBelmonte/SoundClash`.

> **Rotate before submission:** the ElevenLabs key and the Supabase DB password were pasted in chat during development — rotate both. See [`README.md`](../README.md).
