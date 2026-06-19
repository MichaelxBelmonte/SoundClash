# 5-Day Build Plan

> **Status — target architecture, not current build.** This doc describes the *planned* 5-day build, not what ships today. **Supabase (Postgres/RLS/leaderboards), Anthropic Claude (round generation, host banter, mood), async `share_slug` challenges, and the `/api/round/generate`, `/api/host/banter`, `/api/mood`, `/api/challenge/*`, `/api/stems`, `/api/mxm/lyrics|subtitle|match` routes are PLANNED, not built.** What is live today: in-memory session store with ~1s HTTP polling (no DB), real Musixmatch/ElevenLabs/LALAL.AI proxies, server-side answer regeneration, 9 mini-games, and templated (non-LLM) host banter. See `../README.md` ("Status & known limitations") for exactly what runs today.

Soundclash — a cassette/Y2K music party game built on real Musixmatch lyrics, phone controllers, and an AI host, for the Musixmatch Musicathon 2026.

This plan sequences the build so judging-critical capabilities land first:
meaningful Musixmatch usage, a polished shared-room loop, AI host presence,
strong Soundclash visual craft, and optional karaoke/stem features last.

**De-risking note:** the two pieces most likely to sink a music project are already verified live. Musixmatch `track.richsync.get` returns **200 OK** with WORD-level synced lyrics, and ElevenLabs TTS (`POST /v1/text-to-speech/{voice_id}`) returns **200 audio/mpeg**. The day-by-day plan below leans on both from Day 1, so we are integrating known-good APIs rather than discovering them under deadline.

Sibling docs:
- `ARCHITECTURE.md` — system design, proxy routes, data flow.
- `DATA_MODEL.md` — Supabase tables, RLS policies, leaderboard view.
- `PROMPTS.md` — the six Claude prompts (P1–P6), all strict-JSON.
- `COMPLIANCE.md` — Musixmatch references-only rules, copyright display, tracking pixel.
- `README.md` — setup, stack, key-security notes.

---

## Conventions used in this plan

- **All provider calls happen ONLY in Next.js server** (route handlers / server actions) acting as a proxy. The browser never sees `MXM_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_DB_PASSWORD`, or `SUPABASE_PROJECT_REF`. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` reach the client.
- **References only, never lyric text.** A persisted round stores `track_id + line_index + round_type + seed`. The prompt/options/answer TEXT is regenerated LIVE (Musixmatch fetch + Claude) at play time and shown transiently. See `COMPLIANCE.md`.
- **LLM = Claude `claude-opus-4-8`** for round generation, host banter, and mood/theme analysis — ⏳ **Planned.** *Not built:* no `@anthropic-ai/sdk` dependency and no Claude calls exist today. Round answers are regenerated server-side without an LLM (`/api/rounds/check`, `/api/rounds/finish-line`), and host banter is localized string templates (`lib/game/host-banter.ts`). All planned Claude calls would request strict JSON.
- **Secrets live only in `.env.local`** (gitignored). Rotate the ElevenLabs key and the Supabase DB password before submission — both were pasted in chat at some point.

---

## Day-by-day overview

| Day | Theme | Ship-by-end-of-day outcome |
|---|---|---|
| 1 | Scaffold + proxy + live lyrics | App boots; richsync line plays in the browser via server proxy |
| 2 | Round engine + no-mic modes + scoring + leaderboard | Playable single-player game with 2–3 modes and a global board |
| 3 | Async challenge link + AI host | Shareable `share_slug` rounds; Claude banter spoken via ElevenLabs |
| 4 | Remaining modes + karaoke stretch | All 4–5 word modes; karaoke only if time allows |
| 5 | Polish + assets + deploy + submission | Replit demo URL, cover image, 90s video, public repo, submitted |

---

## Day 1 — Scaffold, Supabase, server proxy, live lyric display

**Goal:** a Next.js app that authenticates with Supabase and renders a WORD-level synced lyric line fetched through our own server proxy. This proves the hardest data path on day one.

### Tasks

1. **Scaffold Next.js (App Router, TypeScript) + Tailwind.**
   ```bash
   npx create-next-app@latest soundclash --ts --app --tailwind --eslint
   ```
   Confirm `.env.local` is gitignored; copy `.env.example` → `.env.local` and fill values.

2. **Supabase client wiring — ⏳ Planned (not built).** *Today there is no database:* session state lives in an in-memory, per-instance `Map` (`lib/server/session-store.ts`) and host/player stay in sync via ~1s HTTP polling. No `@supabase` dependency, no `supabase/` directory, no tables. The schema below is the planned target. Browser client would use `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the project ref stays in local/deployment secrets. Apply the schema (full DDL in `DATA_MODEL.md`):
   ```sql
   create table profiles (
     id uuid primary key references auth.users,
     display_name text,
     host_persona text default 'hype',
     created_at timestamptz default now()
   );
   -- games, rounds, challenges, scores + leaderboard_global view
   -- rounds has NO lyric-text columns: track_id, line_index, round_type, seed.
   ```
   ⏳ **Planned:** enable RLS on every table; allow anonymous casual play via `anon_name` (challenge guests, no auth) and authed users via `profiles`.

3. **Server proxy routes (the only place provider keys are used).** Thin handlers that wrap Musixmatch, never exposing `MXM_KEY`. **Live today** (`lib/server/musixmatch.ts`):
   - `GET /api/mxm/search` → `track.search` (200 OK)
   - `GET /api/mxm/track` → track metadata lookup
   - `GET /api/mxm/richsync` → `track.richsync.get` (200 OK, WORD-level)

   ⏳ **Planned** (not built): `GET /api/mxm/lyrics` → `track.lyrics.get`, `GET /api/mxm/subtitle` → `track.subtitle.get`, `GET /api/mxm/match` → `matcher.track.get`.

   Each response includes the Musixmatch `lyrics_copyright` and the tracking pixel/script payload so the client can fire it whenever lyrics show.

4. **Richsync parsing + live lyric display.** The richsync body is a JSON array of lines; each line is:
   ```json
   { "ts": 12.3, "te": 15.8, "x": "full line text",
     "l": [ { "c": "token", "o": 0.4 } ] }
   ```
   Build a `<LiveLyric>` component that, given `ts`/`te`/token offsets `o`, highlights words in time against an audio clock. This is the foundation for both the lyric prompts and the karaoke stretch.

5. **Compliance plumbing.** Display `lyrics_copyright` wherever lyrics render; fire the Musixmatch tracking pixel/script on display. Confirm no lyric text is written to any table.

### Day 1 done when
The app renders one richsync line word-by-word in the browser, sourced entirely through `/api/mxm/richsync`, with the copyright string visible and the tracking pixel firing. No provider key is present in any client bundle.

---

## Day 2 — Round engine, no-mic modes, scoring, leaderboard

**Goal:** a playable single-player game with 2–3 no-microphone modes, speed-aware scoring, and a global leaderboard.

### Runtime Round shape (generated live, NOT persisted with text)

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

### Tasks

1. **Round engine — ⏳ partially built.** *Live today:* server-side answer regeneration via `/api/rounds/check` and `/api/rounds/finish-line` (no LLM, no persisted text), plus the 9 mini-games in `lib/session/mini-games.ts`. ⏳ **Planned (not built):** `POST /api/round/generate` that takes a persisted round reference (`track_id + line_index + round_type + seed`), fetches the lyrics live (Musixmatch), calls Claude to produce the prompt/options/answer, and returns a transient `Round`. The text is never logged or stored. See prompts P1–P3 in `PROMPTS.md`:
   - **P1** round generator for `finish_line` (hide last word(s), player types) and `next_line` (pick correct following line from 4).
   - **P3** `name_song` decoys (pick the correct song from 4 from a snippet).
   - All return strict JSON.

2. **Implement 2–3 modes** (target: `finish_line`, `next_line`, `name_song`):
   - **Finish the Line** — hide the last word(s); player types it. Answer-check is exact/normalized match.
   - **Next Line** — show a line; player picks the correct following line from 4 options.
   - **Name That Song** — show a lyric snippet; player picks the correct song from 4 options.

3. **Scoring.** Word games = correctness + speed bonus that decays with elapsed time. ⏳ **Planned:** persist results to `scores` (`points`, `accuracy`, `mode`, `player_id` or `anon_name`) — today scores live only in the in-memory session store, not a DB.

4. **Leaderboard — ⏳ Planned (not built).** Wire `leaderboard_global` (top scores joined to display names) into a board UI; add daily filtering by `created_at`. Depends on Supabase; there is no `app/leaderboard` page today.

### Day 2 done when
A player can complete a short game of 2–3 modes, see a score with a speed bonus, and appear on the global/daily leaderboard. Rounds persist only references.

---

## Day 3 — Async challenge link (`share_slug`) + AI host (Claude → ElevenLabs)

**Goal:** the social loop and the differentiator — the AI personality host.

### Tasks

1. **Async challenge link — ⏳ Planned (not built).** On finishing a game, create a `challenges` row with a unique `share_slug` and optional `expires_at`. The slug link lets friends replay the **same rounds** (same `track_id + line_index + round_type + seed`) and try to beat the score. No lyric text travels in the shared challenge — the recipient's client regenerates rounds live (Musixmatch + Claude), preserving compliance. None of this exists today (no Supabase, no `app/c/[slug]`).
   - `POST /api/challenge/create` → returns `share_slug` (⏳ Planned).
   - `GET /api/challenge/[slug]` → resolves the game + its rounds (references), loads transiently (⏳ Planned).

2. **AI host — banter generation (Claude) — ⏳ Planned (not built).** *Today* host banter is localized string templates in `lib/game/host-banter.ts` — there is no LLM and no `@anthropic-ai/sdk` dependency. Planned: a selectable persona (Hype-Man / Deadpan British Judge / Diva), stored on `profiles.host_persona`, speaking at round intro, correct answer, wrong answer, score reveal, game outro. Lines are short (1–2 sentences), punchy, no slurs, broadly tasteful.
   - **P5** host system prompt per persona; **P6** host banter per event (`round_intro`, `correct`, `wrong`, `score_reveal`, `game_outro`, `clip_caption`). Strict JSON. Keep lyric usage transient (never logged/stored).
   - `POST /api/host/banter` → Claude (`claude-opus-4-8`) returns the line(s) (⏳ Planned; route does not exist).

3. **AI host — speech (ElevenLabs TTS) — live today.** Server proxy to `POST /v1/text-to-speech/{voice_id}` (verified 200 audio/mpeg, auth via `xi-api-key` header; creator tier, ~131k credits), in `lib/server/elevenlabs.ts`.
   - `POST /api/host/speak` → returns audio/mpeg; the client plays it at each game event. (The shipped route is `/api/host/speak`, not `/api/host/tts`.)

4. **Mood/theme via Claude (replaces the 403 endpoint) — ⏳ Planned (not built).** `track.lyrics.mood.get` is **403 FORBIDDEN** on the key. Planned: use **P4** to derive mood/theme with Claude from the full lyrics instead — to flavor host banter and round selection. No `/api/mood` route exists today.

### Day 3 done when
Finishing a game yields a working `share_slug` link a friend can play on the same rounds; the AI host speaks persona-appropriate banter at each game event. ⏳ **Note:** the `share_slug` flow and Claude-written banter are Planned; today banter is templated (`lib/game/host-banter.ts`) and ElevenLabs-voiced via `/api/host/speak`.

---

## Day 4 — Remaining modes + optional karaoke stretch

**Goal:** complete the no-mic mode set; attempt karaoke only if comfortably ahead.

### Tasks

1. **Misheard Lyrics** — show 4 versions of a line; player picks the REAL one among funny mondegreen decoys. (The mini-game ships in `lib/session/mini-games.ts`; the **P2** Claude decoy generator is ⏳ Planned.)

2. **Speed Lyrics** (stretch within the no-mic set) — timed rapid-fire across short lyric prompts, reusing the existing generators with a tight `time_limit_ms`.

3. **Optional shareable highlight clip** — auto-generate a highlight clip with an AI-narrated caption (P6 `clip_caption` + ElevenLabs). This is a wow-factor extra, not a requirement.

4. **Karaoke (STRETCH / wow) — only if ahead of schedule.** Sing-and-score: mic pitch vs a reference melody (pitch tracking with CREPE/pYIN on a vocal stem) + word/timing accuracy from Musixmatch richsync + ElevenLabs Scribe. Optional stem separation via LALAL.AI (or the user's own Soundberry stem service).
   - **Do NOT use the user's audio-to-MIDI** path — it is not performant.
   - Karaoke scoring = pitch accuracy + word/timing accuracy.
   - The Day 1 `<LiveLyric>` richsync timing is the basis for word/timing accuracy.

### Day 4 done when
The current six tap-first room modes (`finish_line`, `the_drop`, `next_line`,
`artist_pick`, `word_rush`, `name_song`) work end-to-end. Karaoke/stem games are
either functional in the lab or explicitly deferred per the risk register below.

---

## Day 5 — Polish, cover image, 90s demo video, deploy on Replit, submit

**Goal:** a clean, deployed, submitted entry.

### Tasks

1. **Polish.** Tighten the room-code / shareable-link flow (Jackbox/Kahoot-style, zero install), error states, and host audio timing. Verify copyright + tracking pixel fire on every lyric display.
2. **Cover image.** Produce the submission cover image.
3. **90-second demo video.** Script a tight run: join via link → play 2–3 modes → AI host banter → score reveal → challenge a friend via `share_slug` → leaderboard.
4. **Deploy on Replit.** Re-enter all secrets in Replit Secrets (server-side vars never in client). Confirm the public demo URL works end-to-end against live providers.
5. **Security pass.** Rotate the ElevenLabs key and the Supabase DB password (both were pasted in chat); confirm `.env.local` is gitignored and the repo contains no secrets.
6. **Submit.** Complete the submission checklist below.

### Day 5 done when
The submission checklist is fully green and the entry is submitted before the 21 June 2026 deadline.

---

## Risk register

Each risk has an explicit cut-line so we never blow the deadline chasing a nice-to-have. **Cut from the bottom up.**

| # | Risk | Likelihood | Impact | Mitigation | Cut-line (drop if behind) |
|---|---|---|---|---|---|
| R1 | Karaoke (pitch + stem + Scribe) eats the schedule | High | High | Keep it Day 4, isolated behind a feature flag; richsync timing reused from Day 1 | **CUT FIRST.** Ship the 4–5 no-mic modes; karaoke is a stretch, not core. |
| R2 | Highlight-clip generation is fiddly | Medium | Low | Reuse P6 `clip_caption` + existing TTS | **CUT SECOND.** Drop the auto-clip; keep static share + leaderboard. |
| R3 | Speed Lyrics polish runs long | Medium | Low | Reuses existing generators with tighter `time_limit_ms` | **CUT THIRD.** Ship the 4 core word modes; `speed` is optional. |
| R4 | Claude JSON drift breaks round generation | Medium | High | Strict-JSON prompts (P1–P4); validate and re-request on parse failure | Fall back to a pre-validated seed set of rounds for the demo. |
| R5 | ElevenLabs credits / rate limits during demo | Low | Medium | ~131k credits on creator tier; short 1–2 sentence lines | Pre-generate host audio for the demo run and cache it. |
| R6 | Replit deploy/env issues on Day 5 | Medium | High | Deploy a smoke build by Day 3–4, not first on Day 5 | Submit the 90s video as the primary demo; URL as secondary. |
| R7 | Compliance slip (lyric text persisted/redistributed) | Low | Critical | References-only schema; live refetch; copyright + pixel on display | Non-negotiable — never cut. Block submission until verified. |
| R8 | `track.lyrics.mood.get` 403 blocks mood features | Already known | Low | Derive mood/theme with Claude (P4) from full lyrics | N/A — already designed around it. |

**Priority order if the build slips:** keep core no-mic modes + AI host + challenge link + leaderboard + compliance. Cut karaoke (R1), then the auto-clip (R2), then Speed Lyrics (R3).

---

## Submission checklist

- [ ] **Title** — Soundclash.
- [ ] **One-liner** — "Press play. Pick a fight."
- [ ] **Description** — zero-install music party game on real Musixmatch lyrics: one host screen, phones as controllers, BEATBOT voice host, mostly automatic lyric mini-games, and a cassette/Y2K visual system.
- [ ] **Cover image** — produced and attached.
- [ ] **Demo** — public Replit demo URL **and/or** the 90-second demo video.
- [ ] **Public repo** — `github.com/MichaelxBelmonte/SoundClash`, no secrets committed (`.env.local` gitignored).
- [ ] **Meaningful Musixmatch usage** — live today: `track.search`, track metadata, `track.richsync.get` (WORD-level synced gameplay). ⏳ Planned: `track.lyrics.get` (full lyrics), `track.subtitle.get`, `matcher.track.get`, plus karaoke timing reuse. `lyrics_copyright` displayed and tracking pixel fired on every lyric display.
- [ ] **Compliance verified** — references-only persistence (no lyric text stored), live refetch, no redistribution in shared challenges, non-commercial demo use only.
- [ ] **Security** — `npm audit` clean; ElevenLabs key and Supabase DB password rotated; secrets only in `.env.local` / deployment secrets.
