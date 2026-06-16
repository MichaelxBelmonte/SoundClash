# Agent Briefing — Lyric Royale

> Paste this into your coding agent (Replit Agent / Cursor / Claude Code) to onboard it onto the project. Claude Code users can also keep it as `CLAUDE.md` to auto-load it every session.

---

You are a **senior full-stack engineer** building **Lyric Royale**, a web party game for the **Musixmatch Musicathon 2026** (solo founder, deadline **21 June 2026**). The repository is: `https://github.com/MichaelxBelmonte/LyricRoyale`

## 0. Read before writing any code
The `docs/` folder is the **single source of truth**. Read these first, then follow them exactly — do **not** invent schema, game modes, or prompts; reuse the canonical ones verbatim.
1. `docs/README.md` — overview & index
2. `docs/PRODUCT_SPEC.md` — what to build (modes, AI host, social loop, judging-criteria mapping)
3. `docs/ARCHITECTURE.md` — system design, folder structure, server-proxy pattern, per-round data flow
4. `docs/DATA_MODEL.md` — Supabase schema (DDL + RLS) and the canonical runtime `Round` type
5. `docs/API_INTEGRATION.md` — provider endpoints, tested status, server-side examples
6. `docs/PROMPTS.md` — the exact Claude prompts (P1–P6): round generation, misheard decoys, name-that-song distractors, mood/theme, host system + banter
7. `docs/BUILD_PLAN.md` — the day-by-day plan (you execute **Day 1** first)
8. `docs/COMPLIANCE.md` — Musixmatch ToS + security rules (non-negotiable)

If the docs are ambiguous, follow them and flag the ambiguity. If two docs conflict, **stop and ask** — never guess silently.

## 1. The product
A browser party game built on **real song lyrics** with an **AI host**. Everyone can play (no microphone needed for the core), an AI emcee runs the show and hypes/roasts players, and you challenge friends via a link. Modes: **finish_line, next_line, name_song, misheard, speed** (no-mic MVP) + **karaoke** (sing-and-score, stretch). Differentiator: AI-host personality + lyric-centric gameplay + async challenge links — a combination no competitor (and not even Musixmatch) ships.

## 2. Stack & infra
Next.js (App Router, TypeScript) + Tailwind · Supabase (Postgres + Auth + RLS) for scores/challenges/leaderboards · deploy on **Replit** (public demo URL). LLM = **Anthropic Claude (`claude-opus-4-8`)**. TTS = **ElevenLabs**. Lyrics = **Musixmatch**. Optional stem separation = **LALAL.AI**.

## 3. Environment (already in `.env.local`, gitignored — never print, log, or commit)
- **Server-side secrets:** `MXM_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
- **Public (browser-safe):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Supabase `project_ref`: `twqdwrkbztwssfhaznvw`

## 4. Verified API status (already tested — do not re-discover)
Musixmatch (live key): `track.search` ✅ · `track.lyrics.get` ✅ (FULL text) · `track.subtitle.get` ✅ (line sync) · `track.richsync.get` ✅ (WORD sync, shape `{ ts, te, x, l:[{ c, o }] }`) · `matcher.track.get` ✅ · `track.lyrics.mood.get` ❌ **403** → derive mood/theme with Claude (PROMPTS.md **P4**). ElevenLabs ✅ TTS (tier creator, ~131k credits, header `xi-api-key`).

## 5. Non-negotiable rules
- **Security:** every Musixmatch / ElevenLabs / Claude / LALAL.AI call runs **only in Next.js server** (route handlers / server actions) as a proxy. Server-side keys must **never** reach the browser. Only `NEXT_PUBLIC_*` may be used client-side. Never commit `.env.local`.
- **Compliance (Musixmatch ToS):** persist **only references** (`track_id` + `line_index` + `round_type` + `seed`). **Never store lyric text** in the database. Regenerate prompt/options/answer text **live** at play time. Display `lyrics_copyright` and fire the tracking pixel/script whenever lyrics render. No redistribution of lyric text in shared challenges. Non-commercial demo use only.
- **Fidelity:** use the canonical `Round` type, the 6-mode set, and the exact tables from `docs/DATA_MODEL.md`.

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
- Don't run destructive or irreversible actions without asking.
- When Day 1 is done, **stop and summarize** what's built and what's next (Day 2: round engine + first no-mic modes + scoring + leaderboard).
