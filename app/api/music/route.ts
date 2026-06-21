import { NextRequest, NextResponse } from "next/server";
import { getBed, isMusicGenerationAvailable } from "@/lib/server/music-bed";
import type { ErrorResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streams a generated instrumental bed for the audio mini-games. Generation is
// cached in-process, so repeat requests (TV + late joiners) are instant.
export async function GET(req: NextRequest) {
  if (!isMusicGenerationAvailable()) {
    return NextResponse.json<ErrorResponse>(
      { error: "Music generation is not configured.", code: "music_unavailable" },
      { status: 503 },
    );
  }
  try {
    const bytes = await getBed(req.nextUrl.searchParams);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        // Beds are deterministic per spec and safe to cache on the client.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "music_failed";
    console.error("[music]", { code });
    return NextResponse.json<ErrorResponse>(
      { error: "Could not generate the beat.", code: "music_failed" },
      { status: code === "invalid_bed_spec" ? 400 : 502 },
    );
  }
}
