"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/brand/Button";
import type { PublicSessionState, StudioTrack } from "@/lib/session/types";

// Studio Session booth (phone, lobby): the player records ~10s of speech, we
// upload it, and the server turns it into an AI-sung track. The player watches
// their own track cook (state polled by the parent) and can re-record. Recording
// uses the mic (getUserMedia → HTTPS/localhost); phones stay muted for output.

// Mirrors lib/server/studio-session.ts STUDIO_VIBES (kept client-side; that
// module is server-only).
const VIBES = [
  { id: "boombap", label: "Boom-Bap" },
  { id: "trap", label: "Trap" },
  { id: "drill", label: "Drill" },
  { id: "funk", label: "Funk" },
  { id: "lofi", label: "Lo-Fi" },
  { id: "hyperpop", label: "Hyperpop" },
  { id: "pop", label: "Pop" },
];

const MAX_MS = 10_000;
const MIN_MS = 3_000;

type Stage = "idle" | "countdown" | "recording" | "review" | "uploading" | "error";

const STATE_COPY: Record<StudioTrack["state"], string> = {
  transcribing: "Transcribing your words…",
  writing: "Writing your bars…",
  composing: "Singing your track…",
  ready: "Your track is ready 🎤",
  failed: "That take didn't land — try again.",
};

export default function StudioRecordPad({
  code,
  playerId,
  playerName,
  track,
  onSession,
}: {
  code: string;
  playerId: string;
  playerName: string;
  /** The player's own studio track (from polled session state), if any. */
  track: StudioTrack | null;
  onSession: (next: PublicSessionState) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [vibe, setVibe] = useState(VIBES[0].id);
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  // getUserMedia is only exposed in a secure context (HTTPS or localhost). On a
  // plain-HTTP LAN IP (e.g. http://192.168.x.x:3000) the mic is unavailable, so
  // we tell the player to use the HTTPS link instead of failing silently.
  const [micSupported, setMicSupported] = useState(true);
  useEffect(() => {
    setMicSupported(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const autoStopRef = useRef<number | null>(null);

  // Cooking once a take is uploaded and not yet ready/failed.
  const cooking = track != null && track.state !== "ready" && track.state !== "failed";

  function cleanupStream() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => () => cleanupStream(), []);

  async function beginCountdown() {
    setMsg(null);
    setStage("countdown");
    setCountdown(3);
    // Acquire the mic up front so recording starts the instant the countdown ends.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch {
      setStage("error");
      setMsg("Mic access denied — allow the microphone and retry.");
      return;
    }
    let n = 3;
    const tick = window.setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) {
        window.clearInterval(tick);
        startRecording();
      }
    }, 700);
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      blobRef.current = blob;
      cleanupStream();
      setStage("review");
    };
    recorder.start();
    recorderRef.current = recorder;
    startedAtRef.current = performance.now();
    setElapsed(0);
    setStage("recording");

    // Live VU meter so the player can see the mic is hearing them.
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setLevel(Math.min(1, sum / data.length / 90));
        const ms = performance.now() - startedAtRef.current;
        setElapsed(ms);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      // No analyser (rare) — recording still works, just without the meter.
    }

    autoStopRef.current = window.setTimeout(stopRecording, MAX_MS);
  }

  function stopRecording() {
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  async function upload() {
    const blob = blobRef.current;
    if (!blob) return;
    setStage("uploading");
    setMsg(null);
    const form = new FormData();
    form.append("file", blob, "studio.webm");
    form.append("playerId", playerId);
    form.append("playerName", playerName);
    form.append("vibe", vibe);
    // Mobile networks are flaky — one retry before surfacing an error.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/sessions/${code}/studio`, { method: "POST", body: form });
        const payload = (await res.json()) as { session?: PublicSessionState; error?: string };
        if (!res.ok || !payload.session) throw new Error(payload.error ?? "upload failed");
        onSession(payload.session);
        blobRef.current = null;
        setStage("idle");
        return;
      } catch (err) {
        if (attempt === 1) {
          setStage("error");
          setMsg(err instanceof Error ? err.message : "Upload failed — tap to retry.");
        }
      }
    }
  }

  const seconds = (elapsed / 1000).toFixed(1);
  const tooShort = elapsed > 0 && elapsed < MIN_MS;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-black/45">Studio booth · Studio Session</p>
        {track ? (
          <p className="font-mono text-xs text-aqua-600">{track.state === "ready" ? "ready" : track.state === "failed" ? "failed" : "cooking…"}</p>
        ) : null}
      </div>

      {/* A track is cooking or done → show status + offer a re-record. */}
      {track ? (
        <div
          className={[
            "mt-3 rounded-xl border px-4 py-3",
            cooking ? "border-[#C2563B]/30 bg-[#C2563B]/[0.06]" : "border-black/12 bg-white",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            {cooking ? (
              <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#C2563B] border-t-transparent" />
            ) : null}
            <p className="font-condensed text-sm uppercase tracking-[0.03em] text-ink">{STATE_COPY[track.state]}</p>
          </div>
          {cooking ? (
            <>
              <p className="mt-1 text-xs text-black/55">Building your track — this takes about 10–15s. Don't close this.</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-[#C2563B]" />
              </div>
            </>
          ) : null}
          {track.lyric && track.state === "ready" ? (
            <p className="mt-1 line-clamp-2 text-xs text-black/55">“{track.lyric}”</p>
          ) : null}
        </div>
      ) : null}

      {/* No mic on insecure origins — guide the player to the HTTPS link. */}
      {!cooking && !micSupported ? (
        <div className="mt-3 rounded-xl border border-[#C2563B]/30 bg-[#C2563B]/10 p-3 text-sm text-[#A2452E]">
          Recording needs a secure connection. Open this room from the <strong>https://</strong> link
          (the deployed URL) — the microphone is blocked on a plain http:// address.
        </div>
      ) : null}

      {/* Record controls (hidden while a take is cooking or mic unavailable). */}
      {!cooking && micSupported ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {VIBES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVibe(v.id)}
                aria-pressed={vibe === v.id}
                disabled={stage === "recording" || stage === "countdown" || stage === "uploading"}
                className={[
                  "rounded-full border px-3 py-1.5 font-condensed text-xs uppercase tracking-[0.04em] transition-colors disabled:opacity-50",
                  vibe === v.id ? "border-brand bg-brand/10 text-brand" : "border-black/15 text-black/70 hover:border-brand",
                ].join(" ")}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {stage === "countdown" ? (
              <div className="flex aspect-[2/1] w-full items-center justify-center rounded-2xl border-2 border-[#C2563B] bg-[#C2563B]/10">
                <span className="font-condensed text-6xl tabular-nums text-[#15120E]">{countdown > 0 ? countdown : "GO"}</span>
              </div>
            ) : stage === "recording" ? (
              <button type="button" onClick={stopRecording} className="w-full">
                <div className="flex aspect-[2/1] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-[#C2563B] bg-[#C2563B]/10">
                  <span className="font-condensed text-4xl tabular-nums text-[#15120E]">{seconds}s</span>
                  {/* live mic level */}
                  <div className="h-2 w-2/3 overflow-hidden rounded-full bg-black/10">
                    <div className="h-full rounded-full bg-[#C2563B] transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
                  </div>
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-black/45">Tap to stop</span>
                </div>
              </button>
            ) : stage === "review" ? (
              <div className="grid gap-2">
                {tooShort ? (
                  <p className="text-xs text-[#A2452E]">That was a bit short — record at least 3 seconds.</p>
                ) : (
                  <p className="text-xs text-black/55">Got it ({seconds}s). Use this take or record again.</p>
                )}
                <Button type="button" variant="magenta" full disabled={tooShort} onClick={() => void upload()}>
                  Use this take
                </Button>
                <Button type="button" variant="outlineDark" full onClick={() => void beginCountdown()}>
                  Re-record
                </Button>
              </div>
            ) : stage === "uploading" ? (
              <Button type="button" variant="magenta" full disabled>
                Sending to the studio…
              </Button>
            ) : (
              <Button type="button" variant="magenta" full onClick={() => void beginCountdown()}>
                ⏺ {track ? "Record a new take" : "Record ~10s"}
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-black/45">
            Say a line, a brag, a diss — anything. The AI sings it back over a beat.
          </p>
        </>
      ) : null}

      {msg ? <p className="mt-2 text-xs text-[#A2452E]">{msg}</p> : null}
    </div>
  );
}
