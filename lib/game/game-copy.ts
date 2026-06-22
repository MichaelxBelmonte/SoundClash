import type { MiniGameId } from "@/lib/session/types";

// Localized title + instruction per mini-game, so the round copy follows the
// session's chosen narrator language instead of always being English. English is
// the exhaustive base; other languages override the active games and fall back to
// English for anything not yet translated (extend like the banter packs).

export interface GameCopy {
  title: string;
  instruction: string;
}

const EN: Record<MiniGameId, GameCopy> = {
  finish_line: { title: "Finish the Line", instruction: "Tap the missing word." },
  the_drop: { title: "The Drop", instruction: "Tap the missing word as the lyric lands." },
  on_beat: { title: "On The Beat", instruction: "Lock the word right as the beat hits — timing scores." },
  next_line: { title: "Next Line", instruction: "Pick the line that comes next." },
  artist_pick: { title: "Artist Lock", instruction: "Pick the artist behind this lyric." },
  word_rush: { title: "Word Rush", instruction: "Pick the recurring keyword." },
  name_song: { title: "Name That Song", instruction: "Pick the track that contains this lyric." },
  mondegreen: { title: "Misheard", instruction: "One line is the real lyric. The rest are mondegreens." },
  song_mash: { title: "Who Said It", instruction: "Which track dropped this line?" },
  genre_roulette: { title: "Genre Roulette", instruction: "Listen — name the vibe." },
  beat_lock: { title: "Beat Lock", instruction: "Tap on the beat on your phone." },
  stem_heist: { title: "Stem Heist", instruction: "Name the track from this isolated stem." },
  voice_clash: { title: "Voice Clash", instruction: "Listen — then rate the track." },
  studio_session: { title: "Studio Session", instruction: "Listen to each track — then rate them." },
};

// Brand names (Genre Roulette, Beat Lock, Stem Heist, Voice Clash) stay as-is.
const IT: Partial<Record<MiniGameId, GameCopy>> = {
  finish_line: { title: "Completa il verso", instruction: "Tocca la parola mancante." },
  next_line: { title: "Verso successivo", instruction: "Scegli il verso che viene dopo." },
  mondegreen: { title: "Frainteso", instruction: "Un verso è quello vero. Gli altri sono fraintesi." },
  genre_roulette: { title: "Genre Roulette", instruction: "Ascolta — indovina il genere." },
  beat_lock: { title: "Beat Lock", instruction: "Tocca a tempo sul telefono." },
  stem_heist: { title: "Stem Heist", instruction: "Indovina il brano da questo stem isolato." },
  voice_clash: { title: "Voice Clash", instruction: "Ascolta — poi vota la traccia." },
  studio_session: { title: "Studio Session", instruction: "Ascolta ogni traccia — poi votale." },
};

const BY_LANG: Record<string, Partial<Record<MiniGameId, GameCopy>>> = { it: IT };

export function gameCopy(game: MiniGameId, lang: string): GameCopy {
  return BY_LANG[lang]?.[game] ?? EN[game];
}
