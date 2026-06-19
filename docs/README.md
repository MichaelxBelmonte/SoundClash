# Soundclash — Documentation Index & Project Overview

> **Status — read first:** This `docs/` set documents the **target architecture**, not the current build. Supabase/Postgres + RLS, leaderboards, Anthropic Claude (round generation, banter, mood), async share-slug challenges, and several API routes referenced below are **PLANNED, not yet built**. What is actually live today (in-memory session store, ~1s HTTP polling, the real routes, host banter via string templates — no Supabase or Claude) is described in [`../README.md`](../README.md), see its "Status & known limitations" section.

> A zero-install **music party game** built on live Musixmatch lyrics, phone controllers, and an AI host. The product is now branded as **Soundclash**: a cassette/Y2K show where friends enter the same room, tap through mostly automatic lyric mini-games, and let BEATBOT run the stage.

---

## Documentation Index

This README is the front door. Each sibling doc below owns one slice of the project; start here, then follow the link you need.

| Doc | What it covers |
|---|---|
| [`CONTEST_RULES.md`](./CONTEST_RULES.md) | The official Musicathon 2026 rules (eligibility, requirements, judging, prizes, content-usage restrictions) — the source of every project constraint. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design: Next.js server-only provider proxy, route handlers, data flow, deployment on Replit. |
| [`DEPLOY_REPLIT.md`](./DEPLOY_REPLIT.md) | How to publish: Replit **Reserved VM** (not Autoscale), build/run commands, secrets, online multiplayer test. |
| [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) | Game modes (MVP + stretch karaoke), the AI host personas, social loop, scoring, and the feature → judging-criteria map. |
| [`BRAND_SYSTEM.md`](./BRAND_SYSTEM.md) | Soundclash visual system: cassette/J-card/Y2K palette, materials, typography, UI rules, and next brand-alignment tasks. |
| [`PARTY_ROOM_PLAN.md`](./PARTY_ROOM_PLAN.md) | Current pivot plan: shared-screen host, phone controllers, room APIs, ElevenLabs voice host, and LALAL.AI mini-game path. |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | ⏳ Planned Supabase/Postgres tables, RLS, the `leaderboard_global` view, and the runtime `Round` shape — all references-only (no lyric text). Today room state lives in the in-memory store, no DB. |
| [`API_INTEGRATION.md`](./API_INTEGRATION.md) | Musixmatch, ElevenLabs, Anthropic, and Supabase wiring: endpoints, tested status, request/response shapes, env-var usage. Anthropic and Supabase sections are ⏳ Planned. |
| [`PROMPTS.md`](./PROMPTS.md) | ⏳ Planned: the six Claude prompts (P1–P6), all strict-JSON: round generation, decoys, mood/theme, host system prompt, and host banter. Claude is not yet wired; banter is currently string templates. |
| [`BUILD_PLAN.md`](./BUILD_PLAN.md) | The 5-day build sequence — judging-critical capabilities first, the high-risk karaoke stretch last where it can be cut. |
| [`COMPLIANCE.md`](./COMPLIANCE.md) | Hard rules: persist only references, never store lyric text, display `lyrics_copyright`, fire the tracking pixel, non-commercial demo use, key rotation. |

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript) + Tailwind |
| Brand system | Soundclash cassette/Y2K: J-cards, stickers, LED/CRT scoreboards, chrome/neon palette |
| Room state | In-memory server store now; Supabase Realtime/Postgres target |
| Database / Auth | Supabase (Postgres + Auth + RLS) — planned for persistence, scores, leaderboards |
| Deploy | Replit (public demo URL) |
| LLM | Anthropic Claude — planned for richer banter, mood, and generated direction |
| TTS | ElevenLabs |
| Lyrics | Musixmatch |
| Stem separation | LALAL.AI, wired server-side (`/api/lalal/stems`); future room mini-games |

---

## Providers & Tested Status

The Musixmatch key was verified live; ElevenLabs was verified on the creator tier. This is ground truth — build against these statuses, not assumptions.

| Provider | Surface | Tested status |
|---|---|---|
| Musixmatch | `track.search` | **200 OK** |
| Musixmatch | `track.lyrics.get` | **200 OK** — FULL lyrics (not 30% truncated) |
| Musixmatch | `track.subtitle.get` | **200 OK** — line-level synced (LRC) |
| Musixmatch | `track.richsync.get` | **200 OK** — WORD-level synced |
| Musixmatch | `matcher.track.get` | **200 OK** |
| Musixmatch | `track.lyrics.mood.get` | **403 FORBIDDEN** — not on the key → ⏳ Planned: derive mood/theme with Claude (prompt P4) |
| ElevenLabs | `POST /v1/text-to-speech/{voice_id}` | **200 audio/mpeg** — auth via `xi-api-key` header; tier creator, ~131k credits |
| LALAL.AI | API v1 upload/split/check | Wired server-side (`lib/server/lalal.ts`); exposed via `/api/lalal/stems` (the standalone provider lab page has been removed) |
| Anthropic | Claude | ⏳ Planned — not wired (no `@anthropic-ai/sdk` dependency); host banter today is localized string templates in `lib/game/host-banter.ts` |
| Supabase | Postgres + Auth + RLS | ⏳ Planned — not wired (no `@supabase` dependency, no `supabase/` dir); room state is the in-memory store in `lib/server/session-store.ts` |

> The Musixmatch column above is the **upstream provider API** tested status. Only `track.search`, `track.get`, and `track.richsync.get` are exposed as live server routes today (`/api/mxm/search`, `/api/mxm/track`, `/api/mxm/richsync`). Routes like `/api/mxm/lyrics`, `/api/mxm/subtitle`, and `/api/mxm/match` are ⏳ Planned.

The `track.richsync.get` body is a JSON array of lines; each line is:

```json
{
  "ts": 12.34,
  "te": 15.67,
  "x": "Is this the real life? Is this just fantasy?",
  "l": [
    { "c": "Is", "o": 0.0 },
    { "c": " this", "o": 0.21 }
  ]
}
```

Where `ts` = line start (seconds), `te` = line end (seconds), `x` = full line text, and `l` = word-level tokens with `c` = token text and `o` = offset (seconds) within the line. See [`API_INTEGRATION.md`](./API_INTEGRATION.md) for the full request/response reference.

---

## Quickstart

All provider calls happen **only** in the Next.js server (route handlers / server actions) acting as a proxy — the browser never sees server-side keys. Secrets live only in `.env.local` (gitignored). The repo is public at `github.com/MichaelxBelmonte/SoundClash`.

```bash
# 1. Copy the example env file and fill in your secrets
cp .env.example .env.local

# 2. Install dependencies
npm install

# 3. Run the dev server
npm run dev
```

### Environment variables

Server-side secrets (never sent to the browser):

```bash
MXM_KEY=...
ELEVENLABS_API_KEY=...
ANTHROPIC_API_KEY=...
SUPABASE_DB_PASSWORD=...
SUPABASE_PROJECT_REF=your_project_ref
```

Public (safe to expose to the client, prefixed `NEXT_PUBLIC_`):

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

> **Key safety:** Some keys were pasted in chat during development. Before submission, **rotate the ElevenLabs key and the Supabase DB password.** See [`COMPLIANCE.md`](./COMPLIANCE.md).

---

## The Compliance Rule You Cannot Break

Persist **only references** — never store lyric text. A persisted round stores `track_id + line_index + round_type + seed`; the actual prompt/options/answer **text** is regenerated **live** server-side (Musixmatch fetch today via `/api/rounds/check`; Claude is ⏳ Planned) at play time and shown transiently. No redistribution of lyric text in shared challenges. Whenever lyrics are shown, display the Musixmatch `lyrics_copyright` and fire the tracking pixel/script. Non-commercial demo use only. The full rules — and how the [`DATA_MODEL.md`](./DATA_MODEL.md) schema enforces them — live in [`COMPLIANCE.md`](./COMPLIANCE.md).
