# API Integration Guide

> **Status — this is the TARGET architecture, partially shipped.** Several pieces below are still **Planned, not shipped**: Claude **round generation** and **mood/theme** (P1–P4), Supabase Postgres/RLS/leaderboards, and the share-slug challenge flow. The routes `/api/round/generate`, `/api/host/banter`, `/api/mood`, `/api/challenge`, `/api/stems`, `/api/mxm/lyrics`, `/api/mxm/subtitle`, and `/api/mxm/match` **do not exist**. What is live today: Musixmatch proxies (now including `GET /api/mxm/genres` and `GET /api/mxm/tracks`), ElevenLabs TTS, LALAL.AI proxies, an in-memory (no-DB) session store, and **three Claude integrations that did ship** (`lib/server/anthropic.ts`): lyric-game distractors (sent the real lyric line + answer), Voice Clash bars (sent theme + player names), and host-banter localization into non-English/Italian narrator languages (see [§3](#3-anthropic-claude-3-uses-shipped-broader-generation-planned)). Host banter itself is still **localized templates voiced by ElevenLabs** — Claude only translates those templates, it does not write banter live per event. For exactly what is wired up right now, see [`../README.md`](../README.md) → "Status & known limitations".

How Soundclash talks to its four external providers — **Musixmatch** (lyrics, live), **ElevenLabs** (AI host TTS, live), **Anthropic Claude** (lyric distractors + Voice Clash bars + banter localization, **live**; full round generation + mood analysis, **Planned**), and **LALAL.AI** (optional karaoke stem separation, live).

Sibling docs: [`README.md`](../README.md) (stack, setup, key-safety), [`BUILD_PLAN.md`](./BUILD_PLAN.md) (5-day sequencing), [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) (full product/data model), [`PROMPTS.md`](./PROMPTS.md) (the six Claude prompts P1–P6, all strict JSON).

---

## 0. Golden rule — server-side only, no key ever reaches the browser

**Every provider call happens ONLY in the Next.js server** (route handlers under `app/api/**` or server actions), acting as a thin proxy. The browser calls *our* backend; the backend calls the provider. No provider key is ever exposed client-side.

| Secret (server-side only) | Provider | Reached by |
|---|---|---|
| `MXM_KEY` | Musixmatch | `apikey` query param |
| `ELEVENLABS_API_KEY` | ElevenLabs | `xi-api-key` header |
| `ANTHROPIC_API_KEY` (lyric distractors + Voice Clash bars + non-en/it banter — live) | Anthropic Claude | `x-api-key` header (raw `fetch`, no SDK) |
| `ANTHROPIC_BANTER_MODEL` (optional) | Anthropic Claude | model-id override (default `claude-opus-4-8`) |
| `LALAL_API_KEY` | LALAL.AI API v1 | `X-License-Key` header |
| `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (⏳ Planned) | Supabase | migrations / direct Postgres only |

> **Note:** `ANTHROPIC_API_KEY` is read (trimmed) by `lib/server/anthropic.ts` for three live uses — lyric-game distractors, Voice Clash bars, and banter localization — via raw `fetch` to the Messages API; `@anthropic-ai/sdk` is **not** a dependency. With the key absent, distractors fall back to local heuristics, Voice Clash bars use a template, and non-en/it banter falls back to the English pack (en/it use built-in static packs and never call Claude). Full Claude round generation and mood/theme (P1/P3/P4) and Supabase remain **Planned** — `@supabase/*` is not a dependency and there is no `supabase/` directory or DB today.

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` would be exposed to the browser (protected by RLS) **once Supabase is added — Planned**. Secrets live only in `.env.local` (gitignored); on Replit they go in Secrets. **Rotate the ElevenLabs key (and the Supabase DB password if/when Supabase is provisioned) before submission** — the ElevenLabs key was pasted in chat at some point.

> Each fetch example below reads its key from `process.env.*`. If you find a provider key anywhere in a client bundle, that is a compliance/security bug — fix it before shipping.

---

## 1. Musixmatch

- **Base URL:** `https://api.musixmatch.com/ws/1.1`
- **Auth:** `apikey` **query parameter** (e.g. `?apikey=${process.env.MXM_KEY}`), reads `MXM_KEY`.
- **Response envelope:** every response wraps a `message.header` (with `status_code`) and a `message.body`. Always check `message.header.status_code === 200` before reading the body.

### 1.1 Tested status (key verified live)

The Musixmatch key has been exercised live. Treat this table as ground truth. The **Exposed route** column shows the matching Soundclash proxy route; "—" means the upstream endpoint is verified but **not yet** wrapped in a route handler.

| Endpoint | Status | Exposed route | Notes |
|---|---|---|---|
| `track.search` | **200 OK** | `GET /api/mxm/search`, `GET /api/mxm/tracks` | Search tracks. `/search` by free-text query; `/tracks` builds a setlist by `q_artist` (artist) or `f_music_genre_id` (genre), both with `s_track_rating=desc` + `f_has_lyrics=1`, capped at 8. |
| `track.get` | **200 OK** | `GET /api/mxm/track` | Track metadata by id. |
| `music.genres.get` | exercised via `GET /api/mxm/genres` | `GET /api/mxm/genres` | Genre list (id + name), deduped and module-cached in `getGenres()`. Live-key 200 status not separately re-verified here; the front end currently uses the static `CURATED_GENRES` list, so this route is wired but not yet consumed by the UI. |
| `track.richsync.get` | **200 OK** | `GET /api/mxm/richsync` | **WORD-level** synced lyrics. Shape below. |
| `track.lyrics.get` | **200 OK** | — (⏳ Planned) | Returns **FULL lyrics** (not 30% truncated). No `/api/mxm/lyrics` route exists yet. |
| `track.subtitle.get` | **200 OK** | — (⏳ Planned) | Line-level synced lyrics (LRC / line timestamps). No `/api/mxm/subtitle` route exists yet. |
| `matcher.track.get` | **200 OK** | — (⏳ Planned) | Resolve a track from free-text artist + title. No `/api/mxm/match` route exists yet. |
| `track.lyrics.mood.get` | **403 FORBIDDEN** | — (never) | **NOT available on the key → mood/theme would come from Claude** (P4, ⏳ Planned) from the full lyrics. Never call this endpoint at runtime. |

### 1.2 richsync shape (WORD-level)

`track.richsync.get` returns, inside the body, a `richsync_body` string that is itself a JSON array of lines. Each line has the **exact** shape:

```json
{
  "ts": 12.3,
  "te": 15.8,
  "x": "full line text",
  "l": [
    { "c": "full", "o": 0.0 },
    { "c": " line", "o": 0.4 },
    { "c": " text", "o": 0.9 }
  ]
}
```

- `ts` — line start, seconds.
- `te` — line end, seconds.
- `x` — full line text.
- `l` — array of tokens; each `{ c: token_text, o: offset_seconds_within_line }`.

The `<LiveLyric>` component (see [`BUILD_PLAN.md`](./BUILD_PLAN.md) Day 1) highlights tokens word-by-word against an audio clock using `ts`/`te` and per-token `o`. This same timing powers the karaoke word/timing accuracy score.

### 1.3 Which endpoint powers which game mode

| Game mode | Musixmatch endpoint(s) | How it is used |
|---|---|---|
| **Finish the Line** | `track.lyrics.get` | Pick a playable lyric line, hide the last word, build 4 tap options server-side. |
| **The Drop** | `track.lyrics.get` + `track.richsync.get` | Same missing-word mechanic, enhanced with word-level richsync timing when available. |
| **Next Line** | `track.lyrics.get` | Show one line and build 4 deterministic choices for the line that follows. |
| **Artist Lock** | `track.lyrics.get` + `track.search` | Show a lyric and build artist choices from the seed deck. |
| **Word Rush** | `track.lyrics.get` | Analyze recurring lyric keywords transiently and build 4 choices. |
| **Name That Song** | `track.lyrics.get` + `track.search` | Show a lyric and build song-title choices from the seed deck. |
| **Stem Guess Lab** | LALAL.AI upload/split + optional Musixmatch metadata | Split a local clip and guess extracted stem vs backing. |
| **Karaoke (stretch)** | `track.richsync.get` + `track.subtitle.get` | Word/timing accuracy from richsync token offsets; line-level fallback from subtitle. |

> **Mood/theme is NOT a Musixmatch call.** `track.lyrics.mood.get` is 403 on the key — the mood/theme intended to flavor host banter and round selection would come from Claude (P4, ⏳ Planned) reading the full lyrics. See [§3](#3-anthropic-claude-3-uses-shipped-broader-generation-planned). (Today there is no mood/theme analysis at runtime; host banter is template-driven — Claude only localizes those templates per language, see [§3.1](#31-banter-localization-live).)

### 1.4 Mandatory copyright + tracking display rule

**Whenever lyrics are shown, you MUST display the Musixmatch `lyrics_copyright` and fire the Musixmatch tracking pixel/script.** This is a hard licensing rule, not optional polish.

- `track.lyrics.get` / `track.subtitle.get` / `track.richsync.get` return a `lyrics_copyright` (and the subtitle/richsync variants carry their own copyright field). Surface it on every screen that renders lyric text.
- The lyrics body also carries the tracking pixel/script payload (`pixel_tracking_url` / `script_tracking_url` style fields). The client must fire it **on display** of any lyric content.
- Persist **only references** (`track_id + line_index + round_type + seed`) — never store lyric text, and never redistribute lyric text in shared challenges. See [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) §8 (Compliance & data model).

### 1.5 Server-side fetch example

```ts
// app/api/mxm/richsync/route.ts  (Next.js route handler — server only)
import { NextRequest, NextResponse } from "next/server";

const MXM_BASE = "https://api.musixmatch.com/ws/1.1";

export async function GET(req: NextRequest) {
  const trackId = req.nextUrl.searchParams.get("track_id");
  if (!trackId) {
    return NextResponse.json({ error: "track_id required" }, { status: 400 });
  }

  // apikey is a QUERY PARAM; MXM_KEY is read server-side and never sent to the client.
  const url =
    `${MXM_BASE}/track.richsync.get` +
    `?track_id=${encodeURIComponent(trackId)}` +
    `&apikey=${process.env.MXM_KEY}`;

  const res = await fetch(url);
  const json = await res.json();

  const status = json?.message?.header?.status_code;
  if (status !== 200) {
    return NextResponse.json({ error: "musixmatch", status }, { status: 502 });
  }

  const body = json.message.body.richsync;
  // richsync_body is a JSON string: array of { ts, te, x, l:[{c,o}] }
  const lines = JSON.parse(body.richsync_body);

  // Return ONLY what the client needs: timed lines + the copyright + tracking payload.
  // Do NOT persist lyric text anywhere — references only (track_id + line_index + seed).
  return NextResponse.json({
    lines,
    copyright: body.lyrics_copyright,
    tracking: {
      pixel: body.pixel_tracking_url ?? null,
      script: body.script_tracking_url ?? null,
    },
  });
}
```

Sibling proxy routes follow the same pattern. **Live today:** `GET /api/mxm/search` (`track.search`), `GET /api/mxm/track` (`track.get`), `GET /api/mxm/tracks` (`track.search` by `q_artist` / `f_music_genre_id` — the artist/genre setlist builder; needs `artist` **or** a positive integer `genreId`, else 400), and `GET /api/mxm/genres` (`music.genres.get`). **⏳ Planned** (not yet implemented): `GET /api/mxm/lyrics` (`track.lyrics.get`), `GET /api/mxm/subtitle` (`track.subtitle.get`), `GET /api/mxm/match` (`matcher.track.get`). **Do not** add a `mood` route — that endpoint is 403; mood would come from Claude (P4, Planned).

---

## 2. ElevenLabs (AI host TTS + soundtrack)

The AI host (BEATBOT) speaks at: round intro, correct answer, wrong answer, score reveal, game outro. **Today the lines are `{placeholder}` string templates** (see `lib/game/host-banter.ts`) voiced by ElevenLabs. The host picks one of **29 narrator languages** at session creation (`lib/game/languages.ts`, the `eleven_multilingual_v2` set); that code is stored on the session as `narratorLang`, used to select/localize the banter pack (en/it static; others translated once by Claude — see [§3](#3-anthropic-claude-3-uses-shipped-broader-generation-planned)), and sent to ElevenLabs as `language_code` on every TTS call. Runtime values (player names, guesses, scores) are interpolated into the templates **in code**, not by Claude.

- **Auth:** `xi-api-key` **header**, reads `ELEVENLABS_API_KEY`.
- **Tier (verified):** creator, **~131k credits**. Lines are short (1–2 sentences) to stay well within budget.
- **Verified call:** `POST /v1/text-to-speech/{voice_id}` returns **200 `audio/mpeg`**.

### 2.1 Endpoints

| Endpoint | Use |
|---|---|
| `POST /v1/text-to-speech/{voice_id}` | One-shot synthesis → full `audio/mpeg` body. Use for pre-generated / cached banter. |
| `POST /v1/text-to-speech/{voice_id}/stream` | Streaming variant → progressive `audio/mpeg`. Use for low-latency in-game playback. |
| `POST /v1/music` | Prompt-to-music generation. Use offline through `npm run soundtrack:generate`, not on page load. Current default model: `music_v2`. |

Map each persona to a `voice_id`. (Persona selection persisted on a `profiles.host_persona` column is ⏳ Planned, pending Supabase; today there is no DB.)

**Model choice (live):** `createSpeech` in `lib/server/elevenlabs.ts` uses **`eleven_multilingual_v2`** and passes the session `narratorLang` as `language_code` — this is what runs today, chosen so any of the 29 narrator languages is read in-language with good fidelity. It hits the **`/stream`** endpoint (`?output_format=mp3_44100_128`) and pipes the `audio/mpeg` body straight back. (`eleven_turbo_v2_5` remains a lower-latency option if live host lines ever need it, but the shipped code does not use it.)

**Credits note:** synthesis bills credits per character. With ~131k credits and 1–2 sentence host lines, a full demo run is comfortably within budget — but **pre-generate and cache** host audio for the demo (per the [`BUILD_PLAN.md`](./BUILD_PLAN.md) risk register R5) so a live rate-limit or credit hiccup can't interrupt the show.

### 2.2 Optional — Scribe for karaoke word scoring

For the karaoke stretch, ElevenLabs **Scribe** (speech-to-text) can transcribe the player's sung audio so we can score word/timing accuracy against the Musixmatch richsync tokens (`x` / `l[].c` / `l[].o`). This is optional and gated behind the karaoke feature flag — pitch accuracy + word/timing accuracy together form the karaoke score (see [`BUILD_PLAN.md`](./BUILD_PLAN.md) Day 4). Do **not** use the user's audio-to-MIDI path; it is not performant.

### 2.3 Server-side fetch example

```ts
// app/api/host/speak/route.ts  (server only — this is the REAL route, shape simplified)
import { NextRequest, NextResponse } from "next/server";
import { isSupportedLanguage } from "@/lib/game/languages";
import { createSpeech } from "@/lib/server/elevenlabs"; // wraps the ElevenLabs fetch

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const preset = typeof body?.preset === "string" ? body.preset : "hype"; // hype | judge | diva | custom
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId : undefined;
  // Only accept a code that's in the 29-language set; otherwise leave it unset.
  const languageCode = isSupportedLanguage(body?.languageCode) ? body.languageCode : undefined;

  // createSpeech() POSTs to /v1/text-to-speech/{voiceId}/stream?output_format=mp3_44100_128
  // with model_id "eleven_multilingual_v2", language_code, and per-preset voice_settings.
  const audio = await createSpeech({ text, preset, voiceId, languageCode });

  // Stream the audio/mpeg straight back to the client; the key never leaves the server.
  return new NextResponse(audio.body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
```

The route delegates the provider call to `createSpeech` (`lib/server/elevenlabs.ts`), which always uses the streaming endpoint, picks a per-preset library voice (`hype`/`judge`/`diva`/`custom`, overridable via `ELEVENLABS_VOICE_*` env), and clamps `text` to 420 chars.

### 2.4 Soundtrack generation

Soundclash uses ElevenLabs Music v2 to generate reusable static audio. This is an
asset-build step, not a runtime page feature, so credits and latency are
controlled.

```bash
npm run soundtrack:generate
```

The script reads `ELEVENLABS_API_KEY` server-side, calls `POST /v1/music` with
`model_id: "music_v2"`, `output_format=auto`, and `force_instrumental: true`,
then writes:

| File | Runtime use |
|---|---|
| `public/audio/soundclash-mixtape.mp3` | Legacy/setup instrumental loop. |
| `public/audio/soundclash-clash.mp3` | Host/player/solo round screens. |

For the personalized home sound, run:

```bash
npm run soundtrack:signature
```

This uses `ELEVENLABS_API_KEY` to generate an original vocal signature, then uses
`LALAL_API_KEY` to upload that full mix to LALAL.AI, split `vocals`, poll until
success, and download:

| File | Runtime use |
|---|---|
| `public/audio/soundclash-signal-full.mp3` | Home waveform soundtrack. |
| `public/audio/soundclash-signal-vocals.mp3` | Signal Check vocal layer. |
| `public/audio/soundclash-signal-backing.mp3` | Signal Check backing layer. |

`components/audio/AudioDirector.tsx` is the only browser playback layer. It never
sees the provider key, attempts browser autoplay, falls back to first tap when
blocked, alternates tracks on end, and ducks under `soundclash:duck` events
emitted by BEATBOT voice playback. `components/audio/HomeWaveform.tsx` subscribes
to the audio-state/analyser events and controls the same player.

---

## 3. Anthropic Claude (3 uses shipped; broader generation Planned)

> **Three Claude integrations shipped; broader generation is still the target design.** Live today in `lib/server/anthropic.ts` (all raw `fetch`, **no** `@anthropic-ai/sdk`, `cache: "no-store"`, never logged/persisted): (1) **lyric-game distractors** — `generateLyricChoices` is sent the real lyric line + answer for Finish the Line / Next Line / Misheard and returns tempting wrong options (in-memory cache, falls back to local heuristics; model `claude-sonnet-4-6` / `ANTHROPIC_CHOICES_MODEL`); (2) **Voice Clash bars** — `writeBars` is sent the theme + player names and returns short rap bars; (3) **banter localization** — `resolveBanterPack` translates the host banter pack into non-en/it narrator languages, seeing only `{placeholder}` templates (see [§3.1](#31-banter-localization-live)). What's **⏳ Planned** (no routes): full round generation (P1), name-that-song decoys (P3), per-event host banter (P5/P6), and mood/theme (P4) — see [§3.2](#32-planned--round-generation-host-banter-mood). Rounds today are built/validated server-side by the live `/api/rounds/*` routes; the banter text itself is still templates (Claude translates them per language, it does not write banter live per event).

- **Model:** banter + bars default to `claude-opus-4-8` (`DEFAULT_MODEL`, override `ANTHROPIC_BANTER_MODEL`); lyric distractors default to `claude-sonnet-4-6` (override `ANTHROPIC_CHOICES_MODEL`) since they run per-round on the critical path.
- **Transport:** raw `fetch` to `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`. Reads `ANTHROPIC_API_KEY` (trimmed) from the environment — never hardcode the key. **No SDK.**
- **Output:** structured outputs via `output_config: { format: { type: "json_schema", schema } }` so the response is guaranteed parseable. No `thinking` config is sent.

### 3.1 Banter localization (live)

`resolveBanterPack(code, nativeName)` in `lib/server/anthropic.ts` returns the localized BEATBOT banter pack for a session's `narratorLang`:

- **en / it** → built-in **static** packs (`STATIC_BANTER_PACKS` in `lib/game/host-banter.ts`); instant, deterministic, **never** call Claude.
- **any other supported language** → checked against a module-global `Map` cache (`packCache`, keyed by language code); on a miss, Claude is called **once** to translate the English reference pack, the result is cached, and reused across every session on a warm server (a cold start regenerates on first use).
- **fallback** → if Claude is unavailable (missing `ANTHROPIC_API_KEY`, non-200, `stop_reason === "refusal"`, missing/unparseable text block, or any thrown error — all logged under `[anthropic.banter]`), it falls back to `DEFAULT_BANTER_PACK` (the English pack) so the show always has lines. The parser also coerces the model's JSON field-by-field back to English defaults, so a partial response can never yield missing lines.

This runs **inline at session creation** (`app/api/sessions/route.ts` calls `resolveBanterPack`, then `setSessionBanter`), so creating a room in a new non-en/it language adds one Claude round-trip. **Important:** without `ANTHROPIC_API_KEY`, the non-en/it languages silently fall back to English banter text (still read aloud by the chosen voice in the chosen `language_code`).

Claude only ever sees and returns `{placeholder}` template strings (`{name} {guess} {solution} {title} {code} {players} {leader} {index}`) — never live session data. Runtime values are interpolated **in code** by the `fill()` helper after the pack is resolved.

```ts
// lib/server/anthropic.ts  (server only — this is the REAL integration, trimmed)
const BASE = "https://api.anthropic.com/v1";

const response = await fetch(`${BASE}/messages`, {
  method: "POST",
  headers: {
    "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(), // header auth, server-side only
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: process.env.ANTHROPIC_BANTER_MODEL?.trim() || "claude-opus-4-8",
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: BANTER_SCHEMA } },
    messages: [{ role: "user", content: buildPrompt(nativeName) }],
  }),
  cache: "no-store",
});
// On !ok / refusal / no text block / parse error → return null → caller falls back to the English pack.
const data = await response.json();
const text = data.content?.find((b) => b.type === "text")?.text;
const pack = toBanterPack(JSON.parse(text)); // coerced field-by-field to EN defaults
```

### 3.2 Planned — round generation, host banter, mood

> **Not built yet.** The routes in this subsection do not exist; round generation, per-event host banter, and mood/theme are template- or server-regeneration-driven today. This is the target design.

- **Used for:** full round generation (P1), name-that-song decoys (P3), host banter (P5/P6), and **mood/theme analysis (P4)** — the replacement for the 403 `track.lyrics.mood.get` endpoint. *(P2-style misheard/finish-line/next-line decoys already shipped as `generateLyricChoices` — see [§3](#3-anthropic-claude-3-uses-shipped-broader-generation-planned).)*
- **Output:** all six prompts return **strict JSON** via the same `output_config.format` / `json_schema` structured-output shape used live in §3.1. Default to adaptive thinking for the generation prompts.

> The six prompts (P1 round generator, P2 misheard decoys, P3 name-that-song decoys, P4 mood+theme, P5 host system prompt per persona, P6 host banter per event) are fully written in [`PROMPTS.md`](./PROMPTS.md). This subsection covers only the transport.

#### 3.2.1 Where Claude would be used (Planned)

| Prompt | Purpose | Game surface |
|---|---|---|
| **P1** | `finish_line` + `next_line` round generation | Round engine — Planned route `/api/round/generate`. **Today** rounds are built/validated server-side by the live `/api/rounds/finish-line` and `/api/rounds/check` routes, no LLM. |
| **P2** | Misheard mondegreen decoys | Misheard Lyrics mode |
| **P3** | Name-that-song decoys | Name That Song mode |
| **P4** | **Mood + theme analysis** (replaces the 403 mood endpoint) | Round selection + host banter flavor |
| **P5** | Host system prompt per persona | AI host (Hype-Man / Deadpan British Judge / Diva) |
| **P6** | Host banter per event (`round_intro`, `correct`, `wrong`, `score_reveal`, `game_outro`, `clip_caption`) | AI host |

**Compliance:** lyric text passed to Claude at round-generation time is **transient** — never logged, never stored. The persisted round holds only `track_id + line_index + round_type + seed`; the prompt/options/answer text is regenerated live each play.

#### 3.2.2 Server-side example (structured JSON output, Planned)

> This planned example sketches the SDK shape. The one Claude path that actually shipped (§3.1) uses **raw `fetch`**, not `@anthropic-ai/sdk`, and sends no `thinking` config — match that style if this work lands without adding the SDK.

```ts
// app/api/round/generate/route.ts  (⏳ Planned — this route does not exist yet)
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// Strict-JSON schema for a generated round (see PROMPTS.md P1).
const ROUND_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    // string for finish_line; integer option-index for next_line / name_song / misheard
    answer: { anyOf: [{ type: "string" }, { type: "integer" }] },
  },
  required: ["prompt", "answer"],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  // lyricLine is fetched LIVE from Musixmatch upstream and used transiently — never stored.
  const { lyricLine, roundType } = (await req.json()) as {
    lyricLine: string;
    roundType: "finish_line" | "next_line";
  };

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: "You generate Soundclash rounds. Return STRICT JSON only. See PROMPTS.md P1.",
    output_config: { format: { type: "json_schema", schema: ROUND_SCHEMA } },
    messages: [{ role: "user", content: `Round type: ${roundType}\nLine: ${lyricLine}` }],
  });

  // output_config.format guarantees the first block is text with valid JSON.
  const text = response.content.find((b) => b.type === "text");
  const round = JSON.parse(text!.text);

  // Validate, then return transiently. Do NOT log or persist the lyric text or the round text.
  return NextResponse.json(round);
}
```

A planned host banter route (`/api/host/banter`, ⏳ Planned) would use `output_config.format` with the P5 persona system prompt and P6 per-event user message to write banter **live per event**. **Today the only Claude call is the per-language template localization in §3.1** — the localized templates in `lib/game/host-banter.ts` are then synthesized via the live `/api/host/speak` route; Claude does not write per-event banter. A planned mood-analysis route (`/api/mood`, ⏳ Planned) would call Claude with P4 over the full lyrics and return strict-JSON `{ mood, theme }` as the runtime substitute for the 403 Musixmatch mood endpoint; there is no mood analysis at runtime today.

---

## 4. LALAL.AI (optional — stem mini-games / karaoke)

Used for optional stem-based mini-games and the karaoke stretch: upload a short
audio file, separate a stem, and play a blind stem/backing guessing round. (An
earlier `/solo/providers` lab page has been removed; the live surface is the
`/api/lalal/stems` routes below, plus the offline `npm run soundtrack:signature`
asset step in §2.4.)

- **Auth:** `X-License-Key` header, reads `LALAL_API_KEY`.
- **Flow:** upload audio → request split (stem type `vocals`, `drum`, etc.) → poll task status → play returned track URLs. All provider calls run server-side.
- **Current app endpoints:** `POST /api/lalal/stems` and `GET /api/lalal/stems/[taskId]`.
- **No app persistence:** uploaded media IDs, task IDs, and result URLs are transient in the client lab.

### 4.1 Server-side fetch example (upload step)

```ts
// app/api/lalal/stems/route.ts  (server only)
import { NextRequest, NextResponse } from "next/server";

const LALAL_BASE = "https://www.lalal.ai/api/v1";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File;

  const upload = await fetch(`${LALAL_BASE}/upload/`, {
    method: "POST",
    headers: {
      "X-License-Key": process.env.LALAL_API_KEY!, // server-side only
      "Content-Disposition": `attachment; filename="${file.name}"`,
    },
    body: Buffer.from(await file.arrayBuffer()),
  });

  if (!upload.ok) {
    return NextResponse.json({ error: "lalal", status: upload.status }, { status: 502 });
  }

  const { id } = (await upload.json()) as { id: string };
  // Next: POST /api/v1/split/stem_separator/ with { source_id, presets: { stem } },
  // then poll /api/v1/check/ with { task_ids: [task_id] }.
  return NextResponse.json({ uploadId: id });
}
```

---

## 5. Quick reference — env var per call

| Call | Env var read | Auth mechanism |
|---|---|---|
| `GET /api/mxm/search`, `/api/mxm/track`, `/api/mxm/richsync`, `/api/mxm/tracks`, `/api/mxm/genres` (live) | `MXM_KEY` | `apikey` query param |
| `GET /api/mxm/lyrics`, `/api/mxm/subtitle`, `/api/mxm/match` (⏳ Planned) | `MXM_KEY` | `apikey` query param |
| `POST /api/host/speak` (live; `eleven_multilingual_v2`, sends `language_code`) | `ELEVENLABS_API_KEY` | `xi-api-key` header |
| `POST /api/sessions` banter localization (live; non-en/it only, via `resolveBanterPack`) | `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_BANTER_MODEL`) | `x-api-key` header (raw `fetch`) |
| `POST /api/round/generate`, `/api/host/banter`, `/api/mood` (⏳ Planned — none exist) | `ANTHROPIC_API_KEY` | `@anthropic-ai/sdk` (Planned) |
| `POST /api/lalal/stems`, `GET /api/lalal/stems/[taskId]` (live) | `LALAL_API_KEY` | `X-License-Key` |
| `POST /api/sessions`, `GET/POST /api/sessions/[code]`, `/join`, `/round`; `POST /api/rounds/check`, `/api/rounds/finish-line` (live) | — | in-memory session store (no DB), ~1s HTTP polling |

No provider key is ever sent to the browser. The client only ever calls Soundclash's own `/api/**` routes; the routes proxy to the providers using the server-side secrets above.
