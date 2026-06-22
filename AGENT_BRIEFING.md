# Agent Briefing — Soundclash

> Paste this into your coding agent (Replit Agent / Cursor / Claude Code) to onboard it onto the project. Claude Code users can also keep it as `CLAUDE.md` to auto-load it every session.

---

You are a **senior full-stack engineer** building **Soundclash**, a zero-install music party game for the **Musixmatch Musicathon 2026**. The repository is: `https://github.com/MichaelxBelmonte/SoundClash`

## 0. Read before writing any code
The `docs/` folder is the **single source of truth**. Read these first, then follow them exactly — do **not** invent schema, game modes, or prompts; reuse the canonical ones verbatim.
1. `docs/README.md` — overview & index
2. `docs/PRODUCT_SPEC.md` — what to build (modes, AI host, social loop, judging-criteria mapping)
3. `docs/BRAND_SYSTEM.md` — Soundclash cassette/Y2K mood-board rules and UI direction
4. `docs/PARTY_ROOM_PLAN.md` — current shared-room/autopilot implementation plan
5. `docs/ARCHITECTURE.md` — system design, folder structure, server-proxy pattern, per-round data flow
6. `docs/DATA_MODEL.md` — Supabase schema (DDL + RLS) and the canonical runtime `Round` type
7. `docs/API_INTEGRATION.md` — provider endpoints, tested status, server-side examples
8. `docs/COMPLIANCE.md` — Musixmatch ToS + security rules (non-negotiable)

If the docs are ambiguous, follow them and flag the ambiguity. If two docs conflict, **stop and ask** — never guess silently.

## 1. The product
A browser party game built on **real song lyrics** with an **AI host**. One device hosts the room, players join on phones, and BEATBOT runs a mostly automatic lyric show of host-chosen length (**3, 6, or 9 rounds**; default 6). Current modes (9 live): **finish_line, mondegreen, the_drop, on_beat, song_mash, next_line, name_song, artist_pick, word_rush**. Differentiator: cassette/Y2K brand, AI-host personality, lyric-centric gameplay, and a Jackbox-style zero-install room loop.

## 2. Stack & infra
Next.js (App Router, TypeScript) + Tailwind · in-memory room store now, Supabase Realtime/Postgres later · deploy on **Replit** or another public URL. TTS = **ElevenLabs**. Lyrics = **Musixmatch**. Stem separation = **LALAL.AI**. Claude (Anthropic Messages API, raw `fetch` — no SDK) localizes the BEATBOT host "banter pack" into non-`en`/`it` narrator languages.

## 3. Environment (already in `.env.local`, gitignored — never print, log, or commit)
- **Server-side secrets:** `MXM_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
- **Optional:** `ANTHROPIC_BANTER_MODEL` (default `claude-opus-4-8`) and `ANTHROPIC_CHOICES_MODEL` (default `claude-sonnet-4-6`) override Claude models. `ANTHROPIC_API_KEY` powers three live uses — lyric-game distractors (`generateLyricChoices`), Voice Clash bars (`writeBars`), and non-`en`/`it` banter localization; without it each falls back gracefully (local heuristic decoys / templated bars / English banter pack) and the show still runs.
- **Public (browser-safe):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Supabase `project_ref`: keep it in `.env.local` / deployment secrets only.

## 3a. Narrator languages & host banter (implemented)
The host picks one of **29 narrator languages** at room creation (`lib/game/languages.ts` `SUPPORTED_LANGUAGES`, the ElevenLabs `eleven_multilingual_v2` set; `DEFAULT_LANGUAGE = "en"`). The picked code is stored on the session as `narratorLang` and sent to ElevenLabs as `language_code` on every TTS call (`lib/server/elevenlabs.ts`). BEATBOT's lines come from a localized **banter pack**: `en`/`it` use hand-written static packs that ship in-bundle (`lib/game/host-banter.ts`), every other language is generated **once** by Claude and cached module-global, with field-by-field fallback to the English pack if Claude is unavailable. Entry point: `resolveBanterPack(code, nativeName)` in `lib/server/anthropic.ts`. Runtime values (player names, guesses, solutions) are interpolated **in code** via `fill()` — for banter, Claude only ever sees/returns `{placeholder}` templates, never live session data. (Separately, the lyric-distractor and Voice Clash paths in `lib/server/anthropic.ts` *do* send real lyric lines / player names to Claude transiently — `cache: "no-store"`, never logged or persisted.)

## 4. Verified API status (already tested — do not re-discover)
Musixmatch (live key): `track.search` ✅ · `track.lyrics.get` ✅ (FULL text) · `track.subtitle.get` ✅ (line sync) · `track.richsync.get` ✅ (WORD sync, shape `{ ts, te, x, l:[{ c, o }] }`) · `matcher.track.get` ✅ · `track.lyrics.mood.get` ❌ **403** → derive mood/theme with Claude (PROMPTS.md **P4**). ElevenLabs ✅ TTS (tier creator, ~131k credits, header `xi-api-key`).

## 5. Non-negotiable rules
- **Security:** every Musixmatch / ElevenLabs / Claude / LALAL.AI call runs **only in Next.js server** (route handlers / server actions) as a proxy. Server-side keys must **never** reach the browser. Only `NEXT_PUBLIC_*` may be used client-side. Never commit `.env.local`.
- **Compliance (Musixmatch ToS):** persist **only references** (`track_id` + `line_index` + `round_type` + `seed`). **Never store lyric text** in the database. Regenerate prompt/options/answer text **live** at play time. Display `lyrics_copyright` and fire the tracking pixel/script whenever lyrics render. No redistribution of lyric text in shared challenges. Non-commercial demo use only.
- **Brand fidelity:** primary screens must follow `docs/BRAND_SYSTEM.md`: cassette/J-card/Y2K, cream tape labels, ink black, magenta, teal, tangerine, LED/CRT scoreboards, sticker badges, and no generic dashboard feel.

## 6. Your task right now — Day 1 (see `docs/BUILD_PLAN.md`)
Deliver, in order:
1. **Scaffold** the Next.js (App Router, TS, Tailwind) project at the repo root.
2. **Supabase wiring** (browser client uses the publishable key) + **apply the schema** from `docs/DATA_MODEL.md` (tables + RLS policies + indexes + `leaderboard_global` view).
3. **Server proxy route handlers** for the 5 working Musixmatch endpoints, including a **richsync parser** to `{ ts, te, x, l:[{ c, o }] }`.
4. A **`LiveLyric`** component rendering word-synced lyrics from richsync, with the mandatory copyright line + tracking pixel.

**Acceptance criteria:** `npm run dev` runs; I can search a song and watch its word-synced lyrics scroll; no secret is exposed client-side; the schema is live in Supabase; **no lyric text is persisted**.

## 7. Working conventions
- Re-read the relevant doc before each subtask; keep code consistent with the documented architecture and naming.
- Small, reviewable commits. The guard: `.env.local` must always stay gitignored.
- **Never run `next build` / `npm run check` while `next dev` is running** — they share the `.next` folder and the build corrupts the dev server's cache (causes `ENOENT routes-manifest.json` → HTTP 500 on every page). For a quick check while dev is up, use `npm run typecheck` (safe, touches nothing). Only run a full build with the dev server stopped. If you hit the 500: stop dev, `rm -rf .next`, restart dev.
- Don't run destructive or irreversible actions without asking.
- When Day 1 is done, **stop and summarize** what's built and what's next (Day 2: round engine + first no-mic modes + scoring + leaderboard).
