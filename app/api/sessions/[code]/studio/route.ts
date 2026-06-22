import { NextRequest, NextResponse } from "next/server";
import { languageName } from "@/lib/game/languages";
import {
  addStudioTrack,
  getSession,
  nextStudioTrackId,
  updateStudioTrack,
} from "@/lib/server/session-store";
import { generateStudioTrack, getStudioAudio } from "@/lib/server/studio-session";
import type { ErrorResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ code: string }>;
}

function fail(code: string, status = 400) {
  return NextResponse.json<ErrorResponse>({ error: "Studio request failed.", code }, { status });
}

// Serve a generated Studio Session track (one mixed, sung mp3) from the in-memory
// cache. 404 after a restart/HMR drops the cache — the TV then skips the track.
export async function GET(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const trackId = Number(req.nextUrl.searchParams.get("track"));
  if (!Number.isInteger(trackId)) return fail("invalid_studio_track", 400);
  const bytes = getStudioAudio(code, trackId);
  if (!bytes) return fail("studio_audio_missing", 404);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}

// A player uploads their recording (multipart). We register a track, kick off the
// STT → polish → compose pipeline in the background, and return immediately — the
// client polls the session for studioTracks[].state until it's "ready"/"failed".
export async function POST(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (!contentType.includes("multipart/form-data")) return fail("expected_multipart", 400);
    const form = await req.formData();
    const file = form.get("file");
    const playerId = String(form.get("playerId") ?? "");
    const playerName = String(form.get("playerName") ?? "Player").slice(0, 24);
    const vibe = String(form.get("vibe") ?? "boombap");
    if (!(file instanceof Blob)) return fail("missing_recording", 400);
    if (!playerId) return fail("missing_player", 400);
    if (file.size > 3_000_000) return fail("recording_too_large", 413);

    // Resolve the session first (throws session_not_found) for language + register.
    const session = getSession(code);
    const trackId = nextStudioTrackId(code);
    addStudioTrack(code, { id: trackId, playerId, playerName });

    // Fire-and-forget: mirror pipeline progress onto the session track; on success
    // set ready + audioUrl + lyric atomically; on failure mark it failed.
    void generateStudioTrack({
      code,
      trackId,
      playerName,
      audio: file,
      vibe,
      // No languageCode → Scribe auto-detects the spoken language; the room's
      // language is only a fallback for the song-language style hint.
      nativeName: languageName(session.narratorLang),
      onState: (state) => updateStudioTrack(code, trackId, { state }),
    })
      .then((res) =>
        updateStudioTrack(code, trackId, { state: "ready", lyric: res.lyric, audioUrl: res.audioUrl }),
      )
      .catch((err) =>
        updateStudioTrack(code, trackId, {
          state: "failed",
          error: err instanceof Error ? err.message : "studio_failed",
        }),
      );

    return NextResponse.json({ session: getSession(code), trackId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "studio_failed";
    console.error(`[studio] session=${code} content-type=${contentType} failed:`, err);
    return fail(message, message === "session_not_found" ? 404 : 502);
  }
}
