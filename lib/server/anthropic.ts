import "server-only";

import { DEFAULT_BANTER_PACK, staticBanterPack, type BanterPack } from "@/lib/game/host-banter";

const BASE = "https://api.anthropic.com/v1";
// Highest-quality default; override with a faster/cheaper model (e.g.
// claude-haiku-4-5) via env when room-creation latency matters more.
const DEFAULT_MODEL = "claude-opus-4-8";

// Banter packs are language-only (they hold {placeholder} templates, not
// session data), so a single generation per language is reused across every
// session. The cache is module-global and survives between requests on a warm
// server; a cold start simply regenerates on first use.
const packCache = new Map<string, BanterPack>();

function apiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

function model(): string {
  return process.env.ANTHROPIC_BANTER_MODEL?.trim() || DEFAULT_MODEL;
}

// JSON-schema mirror of BanterPack — structured outputs guarantee the shape.
const BANTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "roasts",
    "intros",
    "welcomeWith",
    "welcomeEmpty",
    "finalWith",
    "finalEmpty",
    "crownWith",
    "runnerUp",
    "leaderLine",
    "scoresLocked",
    "answerLine",
    "answersIn",
    "roundLabel",
  ],
  properties: {
    roasts: { type: "array", items: { type: "string" } },
    intros: { type: "array", items: { type: "string" } },
    welcomeWith: { type: "string" },
    welcomeEmpty: { type: "string" },
    finalWith: { type: "string" },
    finalEmpty: { type: "string" },
    crownWith: { type: "string" },
    runnerUp: { type: "string" },
    leaderLine: { type: "string" },
    scoresLocked: { type: "string" },
    answerLine: { type: "string" },
    answersIn: { type: "string" },
    roundLabel: { type: "string" },
  },
} as const;

function buildPrompt(nativeName: string): string {
  return [
    `You localize the spoken lines for BEATBOT, the hype game-show host of a live music party game called Soundclash, into ${nativeName}.`,
    "",
    "Translate the English reference pack below into natural, idiomatic, playful spoken " +
      `${nativeName} — the energy of a charismatic radio/club host, not a literal translation. Keep each line short (it is read aloud by a text-to-speech voice; stay well under 400 characters).`,
    "",
    "STRICT RULES:",
    "- Preserve every {placeholder} token EXACTLY as written ({name}, {guess}, {solution}, {title}, {code}, {players}, {leader}, {second}, {score}, {index}). Do not translate, rename, reorder the braces, or add/remove placeholders.",
    "- Keep the « » guillemets around quoted lyrics/guesses.",
    "- `roasts` must have exactly 3 entries; `intros` must have exactly 3 entries.",
    "- Return only the localized pack via the structured output — no commentary.",
    "",
    "English reference pack:",
    JSON.stringify(DEFAULT_BANTER_PACK, null, 2),
  ].join("\n");
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

// Coerce the model's JSON into a complete BanterPack, falling back field-by-field
// to English so a partial/odd response can never produce missing lines.
function toBanterPack(raw: unknown): BanterPack {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    roasts: asStringArray(data.roasts, DEFAULT_BANTER_PACK.roasts),
    intros: asStringArray(data.intros, DEFAULT_BANTER_PACK.intros),
    welcomeWith: asString(data.welcomeWith, DEFAULT_BANTER_PACK.welcomeWith),
    welcomeEmpty: asString(data.welcomeEmpty, DEFAULT_BANTER_PACK.welcomeEmpty),
    finalWith: asString(data.finalWith, DEFAULT_BANTER_PACK.finalWith),
    finalEmpty: asString(data.finalEmpty, DEFAULT_BANTER_PACK.finalEmpty),
    crownWith: asString(data.crownWith, DEFAULT_BANTER_PACK.crownWith ?? DEFAULT_BANTER_PACK.finalWith),
    runnerUp: asString(data.runnerUp, DEFAULT_BANTER_PACK.runnerUp ?? ""),
    leaderLine: asString(data.leaderLine, DEFAULT_BANTER_PACK.leaderLine),
    scoresLocked: asString(data.scoresLocked, DEFAULT_BANTER_PACK.scoresLocked),
    answerLine: asString(data.answerLine, DEFAULT_BANTER_PACK.answerLine),
    answersIn: asString(data.answersIn, DEFAULT_BANTER_PACK.answersIn),
    roundLabel: asString(data.roundLabel, DEFAULT_BANTER_PACK.roundLabel),
  };
}

async function generateBanterPack(nativeName: string): Promise<BanterPack | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const response = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: 1500,
        output_config: { format: { type: "json_schema", schema: BANTER_SCHEMA } },
        messages: [{ role: "user", content: buildPrompt(nativeName) }],
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[anthropic.banter]", { status: response.status });
      return null;
    }
    const data = (await response.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (data.stop_reason === "refusal") return null;
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) return null;
    return toBanterPack(JSON.parse(text));
  } catch (err) {
    console.error("[anthropic.banter]", { message: err instanceof Error ? err.message : "unknown" });
    return null;
  }
}

export interface BarsInput {
  theme: string;
  vibe: string;
  players: string[];
  /** Native language name for the bars (defaults to English). */
  nativeName?: string;
}

// A short, punchy fallback so Voice Clash always has something to perform even
// without an Anthropic key.
function fallbackBars(input: BarsInput): string {
  const who = input.players.slice(0, 2).join(" and ") || "the whole room";
  return `Yo, it's ${input.vibe} in the building tonight — ${input.theme}! Shout out to ${who}, we don't miss, we levitate. Soundclash on the mic, let's elevate!`;
}

/**
 * Write 4-6 short rap/spoken bars for Voice Clash about a theme, in a vibe, name-
 * dropping a couple of players. Plain text (read aloud by TTS in the host's cloned
 * voice). Falls back to a templated line if Claude is unavailable. Kept under ~380
 * chars so it fits the TTS request and performs in ~20s.
 */
export async function writeBars(input: BarsInput): Promise<string> {
  const key = apiKey();
  if (!key) return fallbackBars(input);
  const lang = input.nativeName?.trim() || "English";
  const players = input.players.slice(0, 6).join(", ") || "the crowd";
  const prompt = [
    `Write 4 to 6 short rap bars in ${lang} for a party game host to perform over a ${input.vibe} beat.`,
    `Theme: ${input.theme}. People in the room: ${players}.`,
    "Make it playful, hype, and clean (no slurs/profanity). Punchy internal rhyme is great.",
    "Return ONLY the bars as plain text separated by newlines — no title, no quotes, no commentary.",
    "Hard limit: 380 characters total.",
  ].join("\n");
  try {
    const response = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[anthropic.bars]", { status: response.status });
      return fallbackBars(input);
    }
    const data = (await response.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (data.stop_reason === "refusal") return fallbackBars(input);
    const text = data.content?.find((block) => block.type === "text")?.text?.trim();
    return text && text.length > 0 ? text.slice(0, 400) : fallbackBars(input);
  } catch (err) {
    console.error("[anthropic.bars]", { message: err instanceof Error ? err.message : "unknown" });
    return fallbackBars(input);
  }
}

// Studio Session: turn a player's spoken clip (already transcribed) into short,
// clean, rhyming bars the AI will sing. Lower-latency model by default (one call
// per player track, off the live round). The refusal guard + "rewrite clean if
// inappropriate" instruction double as the content-safety gate before the text
// becomes a broadcast song.
function polishModel(): string {
  return process.env.ANTHROPIC_POLISH_MODEL?.trim() || "claude-sonnet-4-6";
}

export interface PolishInput {
  /** Speech-to-text of what the player said. */
  transcript: string;
  playerName: string;
  /** Beat vibe (e.g. "trap", "boombap") to steer the flow. */
  vibe?: string;
  /** Native language name for the bars (defaults to English). */
  nativeName?: string;
}

// Without Claude (or on refusal/timeout) we still need singable lyrics: reuse the
// player's own words when present, else a clean hype line. Never echo unmoderated
// text that tripped a refusal — that path returns the hype line instead.
function fallbackPolish(input: PolishInput, allowTranscript = true): string {
  const base = input.transcript.trim().slice(0, 200);
  if (allowTranscript && base) return base;
  return `Yo, ${input.playerName} on the mic — turn it up tonight!`;
}

export async function polishBars(input: PolishInput): Promise<string> {
  const key = apiKey();
  if (!key) return fallbackPolish(input);
  const lang = input.nativeName?.trim() || "their language";
  const transcript = input.transcript.trim();
  const prompt = [
    `A party-game player recorded a short spoken clip. Turn it into 2 to 4 catchy rap/sung bars an AI will SING over a ${input.vibe || "hip-hop"} beat.`,
    `What they said: "${transcript || "(unclear / empty)"}"`,
    "Write the bars in the SAME LANGUAGE they spoke — match the language of that text exactly (e.g. Italian stays Italian). Do NOT translate to English.",
    "Keep their meaning and key words where you can; make it rhyme and flow.",
    `Make it playful, hype, and CLEAN (no slurs/profanity/hate/sexual content). If the input is empty, unclear, or inappropriate, instead write a fun clean hype bar about ${input.playerName} in ${lang}.`,
    "Return ONLY the bars as plain text separated by newlines — max 4 lines, each under 200 characters. No title, no quotes, no commentary.",
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: polishModel(),
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("[anthropic.polish]", { status: response.status });
      return fallbackPolish(input);
    }
    const data = (await response.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    // Refusal = the text was unsafe → never fall back to the raw transcript.
    if (data.stop_reason === "refusal") return fallbackPolish(input, false);
    const text = data.content?.find((block) => block.type === "text")?.text?.trim();
    return text && text.length > 0 ? text.slice(0, 600) : fallbackPolish(input);
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) {
      console.error("[anthropic.polish]", { message: err instanceof Error ? err.message : "unknown" });
    }
    return fallbackPolish(input);
  } finally {
    clearTimeout(timer);
  }
}

// Logical lyric distractors. The local heuristics pick near-miss WORDS that are
// unrelated to the sentence, so the right answer is obvious. Claude instead writes
// wrong options that actually FIT the line (grammar, meaning, rhyme) and are
// tempting. Lower-latency model by default (per-round, on the critical path).
function choicesModel(): string {
  return process.env.ANTHROPIC_CHOICES_MODEL?.trim() || "claude-sonnet-4-6";
}

const CHOICES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["distractors"],
  properties: {
    distractors: { type: "array", items: { type: "string", minLength: 1 } },
  },
} as const;

export type LyricGame = "finish_line" | "next_line" | "mondegreen";

export interface LyricChoicesInput {
  game: LyricGame;
  /** finish_line: the full lyric line · next_line: the preceding line · mondegreen: the real line. */
  line: string;
  /** finish_line: the missing last word · next_line: the real next line · mondegreen: the real line. */
  answer: string;
  /** How many wrong options to return. */
  count: number;
}

const globalForChoices = globalThis as typeof globalThis & {
  __soundclashChoices?: Map<string, string[]>;
};
const choicesCache: Map<string, string[]> = globalForChoices.__soundclashChoices ?? new Map();
globalForChoices.__soundclashChoices = choicesCache;

function normForKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function choicesPrompt(input: LyricChoicesInput): string {
  const n = input.count;
  if (input.game === "finish_line") {
    return [
      "You design TEMPTING wrong answers for a music lyrics game.",
      `Lyric line: "${input.line}"`,
      `Its FINAL word, "${input.answer}", is the correct answer players must guess.`,
      `Give exactly ${n} alternative final words that could BELIEVABLY end this line: same language as the lyric, same part of speech, similar length, plausible rhyme/rhythm and meaning — but WRONG.`,
      "They must be tempting and on-topic — never random, nonsensical, or from another language. Single words, no punctuation. Do NOT include the correct word.",
    ].join("\n");
  }
  if (input.game === "next_line") {
    return [
      'You design tempting wrong answers for a "guess the next line" music game.',
      `Given line: "${input.line}"`,
      `The REAL next line is: "${input.answer}"`,
      `Give exactly ${n} FAKE next lines: plausible continuations in the SAME language, style, syllable count and rhyme feel as the real one — coherent and tempting, but not the real line. No surrounding quotes.`,
    ].join("\n");
  }
  return [
    'You create "mondegreens" (misheard lyrics) for a music game.',
    `Real lyric line: "${input.answer}"`,
    `Give exactly ${n} mondegreens: versions that sound phonetically similar when sung but use different words (ideally a little funny). Same language, similar length, clearly different meaning, believable mishearings. No surrounding quotes.`,
  ].join("\n");
}

/**
 * Ask Claude for context-plausible wrong options for a lyrics round. Returns the
 * distractors (NOT including the answer) or null on any failure/timeout, so the
 * caller can fall back to the local heuristic. Cached per (game, line, answer).
 */
export async function generateLyricChoices(input: LyricChoicesInput): Promise<string[] | null> {
  const key = apiKey();
  if (!key || input.count < 1) return null;
  const cacheKey = `${input.game}:${normForKey(input.line)}:${normForKey(input.answer)}:${input.count}`;
  const cached = choicesCache.get(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  // Generous enough for a fresh call (~2-4s observed); cache makes repeats instant,
  // and a timeout simply falls back to the local heuristic options.
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: choicesModel(),
        max_tokens: 400,
        output_config: { format: { type: "json_schema", schema: CHOICES_SCHEMA } },
        messages: [{ role: "user", content: choicesPrompt(input) }],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("[anthropic.choices]", { status: response.status });
      return null;
    }
    const data = (await response.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (data.stop_reason === "refusal") return null;
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as { distractors?: unknown };
    const seen = new Set<string>([normForKey(input.answer)]);
    const out: string[] = [];
    for (const raw of Array.isArray(parsed.distractors) ? parsed.distractors : []) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim().replace(/^["']+|["']+$/g, "");
      const norm = normForKey(trimmed);
      if (!trimmed || !norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(trimmed);
    }
    if (out.length < input.count) return null;
    const result = out.slice(0, input.count);
    choicesCache.set(cacheKey, result);
    return result;
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError")) {
      console.error("[anthropic.choices]", { message: err instanceof Error ? err.message : "unknown" });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the host-narrator banter pack for a language. English/Italian use the
 * built-in static packs (instant, deterministic). Any other supported language
 * is generated once by Claude and cached; if Claude is unavailable, it falls
 * back to the English pack so the show always has lines to speak.
 */
export async function resolveBanterPack(code: string, nativeName: string): Promise<BanterPack> {
  const preset = staticBanterPack(code);
  if (preset) return preset;

  const cached = packCache.get(code);
  if (cached) return cached;

  const generated = await generateBanterPack(nativeName);
  if (generated) {
    packCache.set(code, generated);
    return generated;
  }
  return DEFAULT_BANTER_PACK;
}
