# Lyric Royale — Documentation Index & Project Overview

> A web **party game** built on real song **lyrics** with an **AI host**, built for the **Musixmatch Musicathon 2026** (solo developer, ~5 days, deadline **21 June 2026**). Everyone can play with no microphone for the core modes, an AI emcee runs the show and hypes/roasts players, and you challenge friends on the same rounds via a shareable link. Positioning: *"Genius tells you what a lyric means; Lyric Royale uses the lyrics you know to make a game out of it."* The white space — confirmed by competitive analysis — is that nobody combines an **AI personality host/judge** + **lyric-centric gameplay** (not pure pitch) + **async challenge links, leaderboards, and shareable clips**, and notably Musixmatch (the sponsor and a judge) ships zero games. Judging is four criteria at **25% each**: Originality, Craft, Use of Musixmatch API, Impact.

---

## Documentation Index

This README is the front door. Each sibling doc below owns one slice of the project; start here, then follow the link you need.

| Doc | What it covers |
|---|---|
| [`CONTEST_RULES.md`](./CONTEST_RULES.md) | The official Musicathon 2026 rules (eligibility, requirements, judging, prizes, content-usage restrictions) — the source of every project constraint. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design: Next.js server-only provider proxy, route handlers, data flow, deployment on Replit. |
| [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) | Game modes (MVP + stretch karaoke), the AI host personas, social loop, scoring, and the feature → judging-criteria map. |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | Supabase/Postgres tables, RLS, the `leaderboard_global` view, and the runtime `Round` shape — all references-only (no lyric text). |
| [`API_INTEGRATION.md`](./API_INTEGRATION.md) | Musixmatch, ElevenLabs, Anthropic, and Supabase wiring: endpoints, tested status, request/response shapes, env-var usage. |
| [`PROMPTS.md`](./PROMPTS.md) | The six Claude prompts (P1–P6), all strict-JSON: round generation, decoys, mood/theme, host system prompt, and host banter. |
| [`BUILD_PLAN.md`](./BUILD_PLAN.md) | The 5-day build sequence — judging-critical capabilities first, the high-risk karaoke stretch last where it can be cut. |
| [`COMPLIANCE.md`](./COMPLIANCE.md) | Hard rules: persist only references, never store lyric text, display `lyrics_copyright`, fire the tracking pixel, non-commercial demo use, key rotation. |

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript) + Tailwind |
| Database / Auth | Supabase (Postgres + Auth + RLS) — scores, challenges, leaderboards |
| Deploy | Replit (public demo URL) |
| LLM | Anthropic Claude — model id `claude-opus-4-8` |
| TTS | ElevenLabs |
| Lyrics | Musixmatch |
| Stem separation (optional, karaoke stretch) | LALAL.AI or the user's own Soundberry stem service |

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
| Musixmatch | `track.lyrics.mood.get` | **403 FORBIDDEN** — not on the key → derive mood/theme with Claude (prompt P4) |
| ElevenLabs | `POST /v1/text-to-speech/{voice_id}` | **200 audio/mpeg** — auth via `xi-api-key` header; tier creator, ~131k credits |
| Anthropic | Claude `claude-opus-4-8` | Round generation, host banter, mood/theme (P4); all calls return strict JSON |
| Supabase | Postgres + Auth + RLS | project_ref `twqdwrkbztwssfhaznvw` |

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

All provider calls happen **only** in the Next.js server (route handlers / server actions) acting as a proxy — the browser never sees server-side keys. Secrets live only in `.env.local` (gitignored). The repo is public at `github.com/MichaelxBelmonte/LyricRoyale`.

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
SUPABASE_PROJECT_REF=twqdwrkbztwssfhaznvw
```

Public (safe to expose to the client, prefixed `NEXT_PUBLIC_`):

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

> **Key safety:** Some keys were pasted in chat during development. Before submission, **rotate the ElevenLabs key and the Supabase DB password.** See [`COMPLIANCE.md`](./COMPLIANCE.md).

---

## The Compliance Rule You Cannot Break

Persist **only references** — never store lyric text. A persisted round stores `track_id + line_index + round_type + seed`; the actual prompt/options/answer **text** is regenerated **live** (Musixmatch fetch + Claude) at play time and shown transiently. No redistribution of lyric text in shared challenges. Whenever lyrics are shown, display the Musixmatch `lyrics_copyright` and fire the tracking pixel/script. Non-commercial demo use only. The full rules — and how the [`DATA_MODEL.md`](./DATA_MODEL.md) schema enforces them — live in [`COMPLIANCE.md`](./COMPLIANCE.md).
