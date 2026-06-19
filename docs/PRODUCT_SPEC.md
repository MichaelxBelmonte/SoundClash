# Soundclash — Product Specification

> **Status:** This spec describes the **target architecture**, not the current build. Several capabilities below are **PLANNED, not yet built** — notably Supabase/Postgres + Row Level Security and any DB-backed scores/challenges/leaderboards, Claude/Anthropic round generation and host banter (host banter today is localized string templates, not an LLM), async share-slug challenges, and the routes `/api/round/generate`, `/api/host/banter`, `/api/mood`, `/api/challenge`, `/api/stems`, `/api/mxm/lyrics`, `/api/mxm/subtitle`, `/api/mxm/match`. What is **live today** is an in-memory session store with ~1s HTTP polling (no DB), real Musixmatch/ElevenLabs/LALAL.AI proxy routes, and server-side answer regeneration. For exactly what ships today, see the **"Status & known limitations"** section of [`README.md`](../README.md).

> A zero-install **music party game** built on real Musixmatch lyrics, phone controllers, a shared host screen, and an AI showrunner voice. Built for the Musixmatch Musicathon 2026.

Positioning: *"Press play. Pick a fight."*

Sibling docs: see [`README.md`](../README.md) for stack/setup,
[`BRAND_SYSTEM.md`](./BRAND_SYSTEM.md) for visual rules, and
[`API_INTEGRATION.md`](./API_INTEGRATION.md) for provider details.

---

## 1. Vision & Positioning

Soundclash turns lyrics people already know into a fast, shared-room party show.
No microphone is needed for the core experience: the host screen shows the round,
phones become controllers, and players mostly tap one answer. BEATBOT, the
cassette AI host, speaks intros, transitions, reveals, leaders, and final-score
moments.

The interface should feel like a playable cassette object: cream J-cards, neon
stickers, chrome buttons, LED scoreboards, clear plastic, tape dividers, and CRT
scanline moments. See [`BRAND_SYSTEM.md`](./BRAND_SYSTEM.md).

### The white space (from competitive analysis)

Nobody combines all three of these in one product:

| Pillar | What it means | Who else does it |
|---|---|---|
| **AI personality host/judge** | A voice host that speaks via ElevenLabs and can later be driven by Claude | Trivia apps have static prompts, not a reactive personality |
| **Lyric-centric gameplay** | Games built on the *words* of songs, including richsync timing | Karaoke apps score pitch; trivia apps don't use real synced lyrics |
| **Shared-room social** | Jackbox-style host screen plus phones, with future leaderboard/challenge loops | Most lyric games are solo, install-bound, or pure karaoke |

Critically: **Musixmatch — the sponsor and a judge — ships zero games.**
Soundclash is a game-shaped showcase for their lyrics and richsync APIs.

### Why this wins judging

Judging is four criteria, **25% each**: Originality, Craft, Use of Musixmatch API, Impact. See the [feature → criteria map](#9-features--judging-criteria) for how each feature is intended to score. The short version: the AI host (Originality), the references-only compliance architecture (Craft + Use-of-Musixmatch), word-level richsync karaoke (Use-of-Musixmatch), and zero-install async social (Impact).

---

## 2. Player Experience — One Session, Start to Finish

This walkthrough is the primary shared-room demo flow.

1. **Land.** The host opens the demo URL and sees the minimal Soundclash home screen: wordmark, BEATBOT, primary actions, and the animated signature waveform.
2. **Create room.** The host creates a session at `/host/new`, choosing a voice preset.
3. **Join.** Players open `/join`, enter the room code, and can leave the stage name empty for an automatic name.
4. **Start show.** The host taps **Auto-pick show** or chooses one seed track from Musixmatch search.
5. **Autopilot.** BEATBOT speaks the first round, then Soundclash rotates a 6-round mini-game set automatically.
6. **Play.** Phones show one simple action: tap an option or lock an answer before reveal. Static ElevenLabs/LALAL audio assets carry the room from setup into gameplay when browser playback is available.
7. **Reveal.** The host screen reveals the answer, scoreboard, and voice line; the next round starts automatically.
8. **Finale.** After round 6, final scores are locked and the winner is crowned.

No lyric text is ever stored or redistributed. Every prompt/option/answer is
regenerated live at play time from a Musixmatch fetch plus server-side round
logic; Claude can later enrich banter and direction without changing that
compliance posture.

---

## 3. Game Modes Overview

| # | Mode | Mic? | Tier | One-liner |
|---|---|---|---|---|
| 1 | Finish the Line | No | Current | Tap the hidden last word of a lyric line |
| 2 | The Drop | No | Current | Tap the missing word as richsync timing lands |
| 3 | Next Line | No | Current | Pick the line that comes next |
| 4 | Artist Lock | No | Current | Pick the artist behind a shown lyric |
| 5 | Word Rush | No | Current | Pick the recurring keyword in the song |
| 6 | Name That Song | No | Current | Pick the correct song for a lyric snippet |
| 7 | Stem Guess | No | Lab | Guess isolated stem vs backing track using LALAL.AI |
| 8 | Karaoke (sing-and-score) | Yes | Stretch / wow | Pitch + word/timing accuracy vs a reference |

Current room scoring is **correctness + speed bonus**. Karaoke scoring would add
pitch accuracy plus word/timing accuracy.

---

## 4. The Five No-Mic Modes (MVP)

Each mode below specifies its **goal**, the **round flow** step by step, and **scoring**. Round prompts/options/answers are generated live; the persisted round stores only references (`track_id`, `line_index`, `round_type`, `seed`). The runtime `Round` shape is in [§8](#8-compliance--data-model).

### 4.1 Finish the Line

- **Goal:** Recall the missing word(s) that end a lyric line.
- **How a round works:**
  1. Server picks a `track_id` + `line_index` (seeded) and fetches full lyrics from Musixmatch (`track.lyrics.get`).
  2. Server-side round logic selects the line, blanks the last word, and builds 4 options.
  3. Client shows the line with a blank and starts the `time_limit_ms` timer (default 15000).
  4. Player taps the answer; submit (or timeout) ends the round.
  5. Answer is matched case-insensitively with light normalization (trim, punctuation-tolerant).
- **Scoring:** `points = base (if correct) + speed_bonus`. `speed_bonus` decays with elapsed time toward zero at the time limit. Wrong/timeout = 0 for that round.

### 4.2 Next Line

- **Goal:** Identify which line comes next in the song.
- **How a round works:**
  1. Server picks `track_id` + `line_index` (seeded); fetches full lyrics.
  2. Claude (prompt **P1**, `next_line`) returns the shown line, the correct following line, and 3 plausible distractor lines — `{ prompt, options[4], answer }` (answer is the index or text).
  3. Client renders the prompt line + 4 shuffled options; timer starts.
  4. Player taps one option.
  5. Correct option closes the round.
- **Scoring:** `base (if correct) + speed_bonus`. Wrong/timeout = 0.

### 4.3 Name That Song

- **Goal:** Match a lyric snippet to the song it comes from.
- **How a round works:**
  1. Server picks a `track_id` + `line_index` (seeded); fetches lyrics for the snippet.
  2. Claude (prompt **P3**, name-that-song decoys) returns the snippet and 4 song choices (correct title + 3 decoys) — `{ prompt, options[4], answer }`.
  3. Client shows the snippet + 4 song options; timer starts.
  4. Player taps the song.
  5. Correct choice closes the round.
- **Scoring:** `base (if correct) + speed_bonus`. Wrong/timeout = 0.

### 4.4 Misheard Lyrics

- **Goal:** Pick the **real** line out of funny mondegreen (misheard) decoys.
- **How a round works:**
  1. Server picks `track_id` + `line_index` (seeded); fetches the real line.
  2. Claude (prompt **P2**, misheard decoys) returns the real line plus 3 funny-but-wrong mondegreens — `{ options[4], answer }` (broadly tasteful, no slurs).
  3. Client shows 4 shuffled versions; timer starts.
  4. Player taps the version they believe is real.
  5. Correct (the real line) closes the round.
- **Scoring:** `base (if correct) + speed_bonus`. Wrong/timeout = 0.

### 4.5 Speed Lyrics *(stretch)*

- **Goal:** Answer as many rapid-fire lyric prompts as possible against the clock.
- **How a round works:**
  1. A single timed session strings together short word-game prompts (mostly Finish-the-Line / Next-Line style), each seeded.
  2. Prompts are pre-generated/queued so there's no per-item wait; each is shown for a brief window.
  3. Player answers fast; the next prompt loads immediately.
  4. Session ends when the global timer expires.
- **Scoring:** Sum of per-item `base + speed_bonus` across the run; the tighter per-item windows make the speed component dominate. Streaks may amplify the bonus (tunable). Wrong answers score 0 for that item and do not pause the clock.

---

## 5. Karaoke — Sing-and-Score (Stretch / wow)

- **Goal:** Sing along to a reference melody and get scored on pitch and on hitting the right words at the right time.
- **How a round works:**
  1. Server selects a track with **word-level synced** lyrics via Musixmatch `track.richsync.get`.
  2. (Optional) A vocal stem is produced via LALAL.AI or the user's own Soundberry stem service for cleaner pitch tracking.
  3. Pitch is tracked from the **vocal stem** with **CREPE/pYIN** and compared to a reference melody. **Do not** use the user's audio-to-MIDI path — it is not performant.
  4. Word/timing accuracy is derived from Musixmatch **richsync** (word-level timestamps) cross-checked with **ElevenLabs Scribe** (speech-to-text).
  5. Lyrics scroll in time with the song while the player sings.
- **Scoring:** `pitch accuracy + word/timing accuracy`. Pitch accuracy compares tracked pitch vs the reference melody; word/timing accuracy rewards singing the right words at the right moments per the richsync timeline.

### Richsync line shape (reference)

`track.richsync.get` returns a JSON array of lines. Each line:

```json
{
  "ts": 12.34,
  "te": 15.67,
  "x": "full line text",
  "l": [
    { "c": "full", "o": 0.00 },
    { "c": "line", "o": 0.42 },
    { "c": "text", "o": 0.88 }
  ]
}
```

Where `ts`/`te` are line start/end seconds, `x` is the full line text, and `l` is the token list with `c` (token text) and `o` (offset seconds within the line).

---

## 6. Live Generation Pipeline (all modes)

All gameplay text is produced at play time, never persisted. High level:

```ts
// Server route handler / server action — keys never reach the browser.
// Persisted round = { track_id, line_index, round_type, seed }  (NO text)
async function buildRound(ref: { trackId: string; lineIndex: number; type: RoundType; seed: number }): Promise<Round> {
  // 1. Fetch lyrics LIVE from Musixmatch (full lyrics, line-level, or word-level synced)
  const lyrics = await mxm.lyricsGet(ref.trackId);        // track.lyrics.get → 200, FULL lyrics

  // 2. Build prompt/options/answer LIVE. Today this is server-side round logic;
  //    the Claude path below (strict JSON; lyric usage transient) is ⏳ PLANNED.
  const generated = await claude.generateRound(ref, lyrics); // P1 / P2 / P3 per round_type (planned)

  // 3. Return transient Round to the client; persist ONLY the reference + score later
  return { ...generated, copyright: lyrics.lyrics_copyright };
}
```

Claude prompts remain the planned enrichment layer for generated banter, mood,
and more adaptive round direction. Any prompt that receives lyric text must treat
it as transient: never logged, cached, or stored. See [`PROMPTS.md`](./PROMPTS.md).

---

## 7. The AI Host

The host is an ElevenLabs TTS voice driven by short, punchy lines. Current room
events use templated lines; Claude can later generate mood-aware event copy.

The app also includes a lightweight music bed. The home waveform uses a
personalized ElevenLabs Music v2 signature with an original Soundclash vocal
hook; LALAL.AI has split that same full mix into vocal and backing stems for the
next Signal Check micro-game. The home currently plays only the full mix to keep
the first screen simple. Round screens use a separate instrumental clash loop.
All assets are static, attempt autoplay, fall back to first tap when browsers
block sound, and duck while BEATBOT speaks. The home waveform keeps one simple
play/stop interaction.

### Personalities

Selectable per game. Each maps to an ElevenLabs voice + a Claude system prompt (**P5**, host system prompt per persona).

| Persona | Voice / vibe | Behavior |
|---|---|---|
| **Hype-Man** | High-energy, loud | Celebrates wins hard, gasses players up, playful trash talk |
| **Deadpan British Judge** | Dry, understated | Cutting wit, unimpressed, deadpan praise and roasts |
| **Diva** | Theatrical, glamorous | Dramatic flourishes, melodramatic verdicts, big reveals |

### When the host speaks

Banter is generated per event via prompt **P6** (host banter per event):

| Event | When it fires | Prompt event key |
|---|---|---|
| Round intro | Before a round (or game) starts | `round_intro` |
| Correct answer | Player answers correctly | `correct` |
| Wrong answer | Player answers wrong / times out | `wrong` |
| Score reveal | Score is revealed (per-round or end) | `score_reveal` |
| Game outro | Game ends | `game_outro` |
| Clip caption | Generating the shareable highlight | `clip_caption` |

Optionally, the host auto-generates a shareable **highlight clip** with an AI-narrated caption (`clip_caption`).

> Mood/theme for track selection and flavor is derived by Claude from the full lyrics (prompt **P4**), because Musixmatch `track.lyrics.mood.get` returns **403** on the key. See [§10](#10-tested-api-status).

---

## 8. Compliance & Data Model

### Hard compliance rules

- **Persist only references — never store lyric text.** A persisted round stores `track_id + line_index + round_type + seed`. The prompt/options/answer **text** is regenerated **live** (Musixmatch fetch + Claude) at play time and shown transiently.
- **No redistribution** of lyric text in shared challenges.
- **Display the Musixmatch `lyrics_copyright`** and fire the tracking pixel/script **whenever lyrics are shown**.
- **Non-commercial demo use only.**
- All provider calls happen **only** in the Next.js server (route handlers / server actions) acting as a proxy; the browser **never** sees server-side keys.
- **Key rotation note:** some keys were pasted in chat — rotate the **ElevenLabs key** and the **Supabase DB password**.

### Runtime Round shape (TypeScript)

Generated live, not persisted with text:

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
  prompt: string;
  options?: string[];
  answer: string | number;
  timeLimitMs: number;
  copyright: string;
}
```

### Supabase / Postgres schema (references only) — ⏳ Planned

> ⏳ **Planned, not built.** There is no Supabase project, no `@supabase` dependency, and no `supabase/` directory in the repo today. Live sessions use an in-memory store (`lib/server/session-store.ts`, a per-instance module-global Map) synced via ~1s HTTP polling — no database, no RLS, no leaderboards yet. The schema below is the target.

When built, RLS will be enabled on every table. Anonymous casual play is allowed via `anon_name` (challenge guests, no auth); authed users go through `profiles`. The Supabase project ref stays in `.env.local` / deployment secrets, not in the public repo.

```sql
create table profiles (
  id uuid primary key references auth.users,
  display_name text,
  host_persona text default 'hype',
  created_at timestamptz default now()
);

create table games (
  id uuid primary key default gen_random_uuid(),
  mode text check (mode in ('finish_line','the_drop','next_line','artist_pick','word_rush','name_song','karaoke')),
  created_by uuid references profiles,
  config jsonb,
  created_at timestamptz default now()
);

-- NO lyric-text columns: only references + a seed.
create table rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games on delete cascade,
  track_id text not null,
  line_index int,
  round_type text,
  seed int,
  time_limit_ms int default 15000,
  position int
);

create table challenges (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games,
  challenger uuid references profiles,
  share_slug text unique not null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games,
  challenge_id uuid references challenges,
  player_id uuid references profiles,
  anon_name text,
  points int default 0,
  accuracy numeric,
  mode text,
  created_at timestamptz default now()
);

-- Top scores joined to display names.
create view leaderboard_global as ( /* top scores joined to profiles.display_name */ );
```

### Environment variables

Server-side secrets (no `NEXT_PUBLIC` prefix): `MXM_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.
Public (browser, protected by RLS): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Secrets live only in `.env.local` (gitignored). The repo is public at github.com/MichaelxBelmonte/SoundClash. See [`README.md`](../README.md) for the local-setup steps.

---

## 9. Social Loop

> ⏳ **Mostly planned.** Room-code / zero-install shared-room play is live today (in-memory sessions + polling). The **async challenge slug** (`app/c/[slug]`, `app/play/[gameId]`, `/api/challenge`) and **leaderboards** (`app/leaderboard`, the `scores` table + `leaderboard_global` view) are PLANNED and depend on the Supabase work in [§8](#8-compliance--data-model).

Web-based, Jackbox/Kahoot-style: zero install, room-code or shareable link.

- **Room code / share link.** Start a game and get a code or link; friends join with no install and no required login.
- **Async challenge.** Play, get a score, share a **slug link** (`challenges.share_slug`, unique). Friends open the link and try to beat you on the **same rounds** — the same `track_id` + `line_index` + `seed`, regenerated live (no lyric text in the link).
- **Leaderboards.** Global + daily. Backed by the `scores` table and the `leaderboard_global` view; anonymous guests appear via `anon_name`, authed players via `profiles.display_name`.
- **Shareable clip.** Optional AI-narrated highlight clip (host caption via prompt P6 `clip_caption`) for organic sharing — no lyric text redistributed.

---

## 10. Tested API Status

Musixmatch key verified **live**:

| Endpoint | Status | Notes |
|---|---|---|
| `track.search` | 200 OK | |
| `track.lyrics.get` | 200 OK | **Full** lyrics (not 30% truncated) |
| `track.subtitle.get` | 200 OK | Line-level synced (LRC) |
| `track.richsync.get` | 200 OK | **Word-level** synced (line shape in [§5](#5-karaoke--sing-and-score-stretch--wow)) |
| `matcher.track.get` | 200 OK | |
| `track.lyrics.mood.get` | **403 FORBIDDEN** | Not available on the key → derive mood/theme with Claude (prompt P4) |

**ElevenLabs** verified: tier creator, ~131k credits. `POST /v1/text-to-speech/{voice_id}` returns 200 `audio/mpeg`; auth via the `xi-api-key` header.

**Anthropic (Claude):** ⏳ **Planned, not built.** There is no `@anthropic-ai/sdk` dependency and no Claude calls wired in today; round prompts/options/answers are regenerated server-side from Musixmatch fetches plus round logic, and host banter is localized string templates (`lib/game/host-banter.ts`), not an LLM. When wired, the target model is `claude-opus-4-8`, all host/round generation will run server-side, and the browser will never see the key.

---

## 11. MVP vs Stretch

| Area | MVP | Stretch / wow |
|---|---|---|
| Game modes | Finish the Line, Next Line, Name That Song, Misheard Lyrics | Speed Lyrics; Karaoke (sing-and-score) |
| Input | No microphone — type/tap | Microphone (karaoke) |
| AI host | 3 personas; speaks at round intro / correct / wrong / score reveal / outro | Auto-generated AI-narrated highlight clip |
| Lyrics use | Full lyrics + line-level synced (LRC) | Word-level richsync; ElevenLabs Scribe word/timing scoring |
| Pitch | — | CREPE/pYIN on a vocal stem (LALAL.AI or Soundberry); reference-melody scoring |
| Social | Room code, async challenge slug, global + daily leaderboards, anon play | Shareable highlight clip with AI caption |
| Mood/theme | Claude-derived (P4) replacing the 403 endpoint | — |

---

## 12. Features → Judging Criteria

Judging: four criteria, **25% each**. This maps each feature to the criterion it primarily advances.

| Feature | Originality | Craft | Use of Musixmatch API | Impact |
|---|:--:|:--:|:--:|:--:|
| AI personality host (3 personas, live Claude banter + ElevenLabs TTS) | ● | ● | | ● |
| Lyric-centric no-mic modes (Finish/Next/Name/Misheard) | ● | ● | ● | ● |
| Misheard Lyrics (mondegreen decoys via Claude) | ● | | ● | |
| Word-level **richsync** karaoke (pitch + word/timing) | ● | ● | ● | |
| References-only compliance architecture (no lyric text persisted) | | ● | ● | |
| `lyrics_copyright` display + tracking pixel on every lyric view | | ● | ● | |
| Claude-derived mood/theme (replaces 403 endpoint) | ● | ● | ● | |
| Async challenge link on the **same rounds** (seeded) | ● | ● | | ● |
| Room-code / zero-install web play (Jackbox/Kahoot-style) | | ● | | ● |
| Global + daily leaderboards | | ● | | ● |
| Shareable AI-narrated highlight clip | ● | | | ● |
| Server-side proxy (keys never reach the browser) | | ● | ● | |

● = the feature meaningfully contributes to that 25% criterion.

---

## 13. Stack (summary)

Next.js (App Router, TypeScript) + Tailwind. **Live today:** TTS = ElevenLabs, Lyrics = Musixmatch, optional stem separation = LALAL.AI (or the user's own Soundberry stem service), and an in-memory session store synced via ~1s HTTP polling. **⏳ Planned:** Supabase (Postgres + Auth + RLS) for scores/challenges/leaderboards, and an LLM layer = Anthropic Claude (target `claude-opus-4-8`) for round generation / host banter / mood. Deploy on Replit (public demo URL).

Full setup and key-safety rules: [`README.md`](../README.md). Claude prompts P1–P6: [`PROMPTS.md`](./PROMPTS.md).
