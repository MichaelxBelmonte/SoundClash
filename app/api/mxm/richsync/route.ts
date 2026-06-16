import { NextRequest, NextResponse } from "next/server";
import { getRichsyncPreview } from "@/lib/server/musixmatch";
import type { ErrorResponse, RichsyncResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const trackId = Number(req.nextUrl.searchParams.get("trackId"));

  if (!Number.isInteger(trackId) || trackId <= 0) {
    return NextResponse.json<ErrorResponse>(
      { error: "Invalid trackId.", code: "invalid_track_id" },
      { status: 400 },
    );
  }

  try {
    const preview = await getRichsyncPreview(trackId);
    return NextResponse.json<RichsyncResponse>({ preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown richsync error";
    console.error("[mxm.richsync]", { message });
    return NextResponse.json<ErrorResponse>(
      { error: "No richsync preview available for this track.", code: "richsync_unavailable" },
      { status: 502 },
    );
  }
}
