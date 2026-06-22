"use client";

import { useEffect, useRef, useState } from "react";
import JCard from "@/components/brand/JCard";
import Icon from "@/components/ui/Icon";

const SEEN_KEY = "sc_intro_seen";

/**
 * Landing intro: the BEATBOT mascot video (transparent WebM/VP9 alpha, MP4
 * fallback). The splash is framed as a cassette J-card over a dimmed/blurred
 * landing, so the intro reads as the clear foreground moment instead of floating
 * over the page's own CTAs. Shown once per session and always skippable (button or
 * Esc). Audio needs a user gesture, so the video is gated behind a play key; the
 * soundtrack stays silent until the video ends (see AudioDirector).
 */
export default function BrandIntro() {
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<"splash" | "playing">("splash");
  const [leaving, setLeaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    try {
      const skip = new URLSearchParams(window.location.search).has("nointro");
      if (skip || sessionStorage.getItem(SEEN_KEY) === "1") setVisible(false);
    } catch {
      /* sessionStorage unavailable — just show the intro */
    }
  }, []);

  // Esc skips the intro from either phase.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function finish() {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    // Intro over → tell the AudioDirector to fade the soundtrack in now (it stayed
    // silent while the video played, so the song never starts on top of the intro).
    window.dispatchEvent(new CustomEvent("soundclash:intro", { detail: { phase: "end" } }));
    setLeaving(true);
    window.setTimeout(() => setVisible(false), 450);
  }

  function play() {
    setPhase("playing");
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      void v.play().catch(() => finish());
    }
  }

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center px-6 transition-opacity duration-500 ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Soundclash intro"
    >
      {/* Dim + blur the landing so the intro is unmistakably the foreground. */}
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[3px]" aria-hidden />

      <div className="relative flex w-full flex-col items-center">
        {/* Alpha video — always mounted for preload; shown only while playing. */}
        <video
          ref={videoRef}
          playsInline
          preload="auto"
          onEnded={finish}
          onTimeUpdate={() => {
            const v = videoRef.current;
            if (v && v.duration) setProgress(v.currentTime / v.duration);
          }}
          className={`aspect-video w-[min(90vw,900px)] max-h-[70vh] object-contain ${
            phase === "playing" ? "block" : "hidden"
          }`}
        >
          <source src="/brand/intro.webm" type="video/webm" />
          <source src="/brand/intro.mp4" type="video/mp4" />
        </video>

        {phase === "splash" ? (
          <div className="w-[min(90vw,420px)] animate-fade-up">
            <JCard spine="SIDE A · INTRO" contentClassName="px-7 py-8 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wordmark.png" alt="Soundclash" className="mx-auto h-7 w-auto max-w-full" />
              <p className="mt-1 font-mono text-[0.55rem] uppercase tracking-[0.3em] text-black/40">Intro</p>

              <button
                type="button"
                onClick={play}
                autoFocus
                aria-label="Press play"
                className="relative mx-auto mt-7 flex h-20 w-20 items-center justify-center rounded-full bg-[#C2563B] text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
              >
                <span aria-hidden className="absolute inset-0 animate-ping rounded-full ring-2 ring-[#C2563B]/40" />
                <Icon name="play" size={30} className="relative translate-x-0.5" />
              </button>

              <p className="mt-5 font-condensed text-xl uppercase tracking-[0.04em] text-ink">Watch the intro</p>
              <p className="mt-1 text-xs leading-5 text-black/50">Meet BEATBOT — best with sound on.</p>

              <button
                type="button"
                onClick={finish}
                className="mt-6 inline-flex h-10 items-center gap-1.5 rounded-full border border-black/20 bg-paper-raised px-5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-black/65 transition-colors hover:border-[#C2563B] hover:text-[#C2563B]"
              >
                Skip intro <span aria-hidden>→</span>
              </button>
            </JCard>
          </div>
        ) : (
          <div className="mt-4 w-[min(90vw,900px)]">
            {/* Video progress — so the intro never feels stuck, and the end is in sight. */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-black/15">
              <div
                className="h-full bg-[#C2563B] transition-[width] duration-200"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={finish}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-black/20 bg-paper-raised/90 px-5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-black/65 backdrop-blur transition-colors hover:border-[#C2563B] hover:text-[#C2563B]"
              >
                Skip <span aria-hidden>▶▶</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
