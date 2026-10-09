"use client";

import { useEffect, useRef, useState } from "react";

// Matchradions spelare. Hela programmet mixas i webbläsaren med Web Audio och
// schemaläggs på ljudklockan vid klicket:
//   jingel → röst (publikbädden tonas in och loopar lågt under) →
//   publiken tonas ut → jingel.
// Paus = suspend() på klockan, så allt håller takten. Inget laddas förrän
// besökaren klickar på play.

const JINGLE_URL = "/radio/jingle.mp3";
const CROWD_URL = "/radio/crowd.mp3";
const CROWD_VOLUME = 0.18;
const FADE_S = 1.5;

export type RadioEpisodeView = { title: string; dateLabel: string; audioUrl: string; script: string };

// Bara rösten är obligatorisk — saknas jingel eller publikbädd spelas programmet utan dem.
type Buffers = { jingle: AudioBuffer | null; crowd: AudioBuffer | null; voice: AudioBuffer };
type Show = { start: number; total: number };
type State = "idle" | "loading" | "playing" | "paused" | "error";

async function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/** Lägger ut hela programmet på ljudklockan och returnerar start och längd. */
function scheduleShow(ctx: AudioContext, b: Buffers): Show {
  const t0 = ctx.currentTime + 0.05;
  const introLen = b.jingle?.duration ?? 0;
  const voiceAt = t0 + introLen;
  const voiceEnd = voiceAt + b.voice.duration;

  const play = (buffer: AudioBuffer, at: number, dest: AudioNode = ctx.destination) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    src.start(at);
    return src;
  };

  if (b.jingle) play(b.jingle, t0);
  play(b.voice, voiceAt);

  if (b.crowd) {
    const crowdGain = ctx.createGain();
    crowdGain.connect(ctx.destination);
    crowdGain.gain.setValueAtTime(0, voiceAt);
    crowdGain.gain.linearRampToValueAtTime(CROWD_VOLUME, voiceAt + FADE_S);
    crowdGain.gain.setValueAtTime(CROWD_VOLUME, voiceEnd);
    crowdGain.gain.linearRampToValueAtTime(0, voiceEnd + FADE_S);
    const crowd = play(b.crowd, voiceAt, crowdGain);
    crowd.loop = true;
    crowd.stop(voiceEnd + FADE_S);
  }

  // Utan publikbädd finns ingen utfasning att vänta in
  const outroAt = voiceEnd + (b.crowd ? FADE_S : 0);
  if (b.jingle) play(b.jingle, outroAt);
  return { start: t0, total: outroAt + (b.jingle?.duration ?? 0) - t0 };
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M5 3.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M5 3.5h3v11H5zM10 3.5h3v11h-3z" fill="currentColor" />
    </svg>
  );
}

export function RadioPlayer({ title, dateLabel, audioUrl, script }: RadioEpisodeView) {
  // Ett stabilt objekt med föränderliga fält, så att städningen nedan når
  // den AudioContext som skapas först vid klick.
  const audio = useRef<{ ctx: AudioContext | null; buffers: Buffers | null }>({ ctx: null, buffers: null });
  const starting = useRef(false);
  const [state, setState] = useState<State>("idle");
  const [show, setShow] = useState<Show | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const holder = audio.current;
    return () => {
      void holder.ctx?.close();
    };
  }, []);

  // Förloppet följer ljudklockan (står still när den är pausad).
  useEffect(() => {
    if (state !== "playing" || !show) return;
    const id = setInterval(() => {
      const ctx = audio.current.ctx;
      if (!ctx) return;
      const t = ctx.currentTime - show.start;
      if (t >= show.total) {
        setElapsed(0);
        setState("idle");
      } else {
        setElapsed(Math.max(0, t));
      }
    }, 250);
    return () => clearInterval(id);
  }, [state, show]);

  async function onClick() {
    const holder = audio.current;
    if (state === "loading") return;
    if (state === "playing" && holder.ctx) {
      await holder.ctx.suspend();
      setState("paused");
      return;
    }
    if (state === "paused" && holder.ctx) {
      await holder.ctx.resume();
      setState("playing");
      return;
    }
    // idle eller error: (ladda och) spela programmet från början.
    // AudioContext skapas i klicket så att webbläsaren tillåter ljud.
    // Vakten hindrar två snabba klick från att schemalägga två program.
    if (starting.current) return;
    starting.current = true;
    try {
      const ctx = (holder.ctx ??= new AudioContext());
      void ctx.resume(); // i klicket — Safari kräver det innan första await
      if (!holder.buffers) {
        setState("loading");
        try {
          const [jingle, crowd, voice] = await Promise.allSettled([
            loadBuffer(ctx, JINGLE_URL),
            loadBuffer(ctx, CROWD_URL),
            loadBuffer(ctx, audioUrl),
          ]);
          if (voice.status === "rejected") throw voice.reason;
          for (const r of [jingle, crowd]) {
            if (r.status === "rejected") console.warn("[radio] ljudfil saknas, spelar utan:", r.reason);
          }
          holder.buffers = {
            jingle: jingle.status === "fulfilled" ? jingle.value : null,
            crowd: crowd.status === "fulfilled" ? crowd.value : null,
            voice: voice.value,
          };
        } catch (err) {
          console.error("[radio] kunde inte ladda ljudet:", err);
          setState("error");
          return;
        }
      }
      await ctx.resume();
      setElapsed(0);
      setShow(scheduleShow(ctx, holder.buffers));
      setState("playing");
    } finally {
      starting.current = false;
    }
  }

  const playing = state === "playing";
  const progress = show ? Math.min(1, elapsed / show.total) : 0;
  const status =
    state === "error" ? "Kunde inte ladda ljudet – försök igen" : state === "loading" ? "Laddar …" : dateLabel;

  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={state === "loading"}
          aria-label={playing ? `Pausa ${title}` : `Spela ${title}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-surface-dark transition-transform hover:scale-105 disabled:opacity-60"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs text-ink-muted">{status}</p>
        </div>
        <span className="text-xs tabular-nums text-ink-muted">
          {fmt(elapsed)}
          {show ? ` / ${fmt(show.total)}` : ""}
        </span>
      </div>
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="Förlopp"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
          Läs manuset
        </summary>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{script}</p>
      </details>
      <p className="mt-2 text-[11px] text-ink-muted">AI-genererat från veckans resultat · Röst: ElevenLabs</p>
    </div>
  );
}
