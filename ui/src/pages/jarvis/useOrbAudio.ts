import { useEffect, useRef } from "react";

/**
 * Drives the arc-reactor's visual properties from a real-time audio
 * source. The reactor reads these CSS custom properties:
 *
 *   --orb-core-scale   1.0 → 1.2     (RMS amplitude)
 *   --orb-emit         0.3 → 0.85    (peak frequency amplitude)
 *   --orb-halo         0.4 → 0.9     (peak amplitude, softer)
 *   --orb-cw-mult      1.0 → 3.0     (low-band energy, drives outer rings)
 *   --orb-ccw-mult     1.0 → 3.0     (mid-band energy, drives mid rings)
 *   --orb-x / --orb-y                (organic Perlin-style drift)
 *
 * It also brightens the 60 rim ticks in sequence based on high-band
 * energy, so loud sibilants visibly "light up" the rim.
 *
 * In Commit 2, a real ElevenLabs TTS MediaStream lands on the analyser
 * via attachStream(). For now the page can call playDemoSpeech() to
 * synthesize a believable speech-like waveform so the binding is
 * visible without keys.
 */
export interface OrbAudioController {
  /** Attach a MediaStream (e.g., from ElevenLabs WebRTC) to the analyser. */
  attachStream: (stream: MediaStream) => void;
  /** Attach an HTMLAudioElement (e.g., browser TTS audio) to the analyser. */
  attachAudioElement: (el: HTMLAudioElement) => void;
  /** Synthesize a fake speech-like signal (for demos / Commit 1). */
  playDemoSpeech: (durationSec?: number) => void;
  /** Stop any currently-playing demo audio. */
  stopDemo: () => void;
}

export interface UseOrbAudioOptions {
  /** Ref to the .jarvis-reactor element whose CSS vars we drive. */
  reactorRef: React.RefObject<HTMLElement | null>;
  /** Ref to the <g data-tick-group> SVG group whose children we brighten. */
  tickGroupRef: React.RefObject<SVGGElement | null>;
  /** Current HUD state — controls breathing baseline + scan effects. */
  state: "idle" | "listening" | "processing" | "speaking" | "interrupted";
}

export function useOrbAudio({
  reactorRef,
  tickGroupRef,
  state,
}: UseOrbAudioOptions): OrbAudioController {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(performance.now());
  const stateRef = useRef(state);
  const audioBoundRef = useRef(false);
  const activeElSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const activeStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Keep latest state visible inside the rAF closure without re-binding.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Lazy AudioContext init — browsers block construction without a user
  // gesture, so we both create on first use AND resume on first click.
  function ensureAudio(): AudioContext | null {
    if (ctxRef.current) return ctxRef.current;
    const Ctx =
      typeof window !== "undefined"
        ? (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
        : null;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.65;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    masterGainRef.current = gain;
    freqRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    timeRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    return ctx;
  }

  const attachStream: OrbAudioController["attachStream"] = (stream) => {
    const ctx = ensureAudio();
    if (!ctx || !analyserRef.current) return;
    if (activeStreamSourceRef.current) {
      try {
        activeStreamSourceRef.current.disconnect();
      } catch {}
    }
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyserRef.current);
    activeStreamSourceRef.current = src;
    audioBoundRef.current = true;
  };

  const attachAudioElement: OrbAudioController["attachAudioElement"] = (el) => {
    const ctx = ensureAudio();
    if (!ctx || !analyserRef.current) return;
    if (activeElSourceRef.current) {
      try {
        activeElSourceRef.current.disconnect();
      } catch {}
    }
    const src = ctx.createMediaElementSource(el);
    src.connect(analyserRef.current);
    src.connect(ctx.destination);
    activeElSourceRef.current = src;
    audioBoundRef.current = true;
  };

  // Synthesize speech-like audio: harmonic oscillator stack shaped into
  // 150–300ms syllables + bandpassed noise bursts for consonant texture.
  const playDemoSpeech: OrbAudioController["playDemoSpeech"] = (
    durationSec = 3
  ) => {
    const ctx = ensureAudio();
    if (!ctx || !masterGainRef.current) return;
    if (ctx.state === "suspended") ctx.resume();
    audioBoundRef.current = true;

    const gain = masterGainRef.current;
    const t0 = ctx.currentTime;
    const tEnd = t0 + durationSec;
    let cursor = t0 + 0.05;
    let pIdx = 0;
    const fundamentals = [180, 210, 165, 220, 195];

    while (cursor < tEnd) {
      const f = fundamentals[pIdx++ % fundamentals.length];
      const syllableDur = 0.16 + Math.random() * 0.18;
      const gapDur = 0.06 + Math.random() * 0.08;

      [1, 2].forEach((mult, idx) => {
        const osc = ctx.createOscillator();
        osc.type = idx === 0 ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(f * mult, cursor);
        osc.frequency.linearRampToValueAtTime(
          f * mult * (0.92 + Math.random() * 0.2),
          cursor + syllableDur
        );
        const g = ctx.createGain();
        const peak = idx === 0 ? 0.22 : 0.07;
        g.gain.setValueAtTime(0, cursor);
        g.gain.linearRampToValueAtTime(peak, cursor + 0.04);
        g.gain.linearRampToValueAtTime(peak * 0.7, cursor + syllableDur * 0.7);
        g.gain.linearRampToValueAtTime(0, cursor + syllableDur);
        osc.connect(g).connect(gain);
        osc.start(cursor);
        osc.stop(cursor + syllableDur + 0.02);
      });

      if (Math.random() < 0.55) {
        const bufLen = Math.floor(ctx.sampleRate * 0.05);
        const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 2200 + Math.random() * 2400;
        bp.Q.value = 0.9;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0, cursor);
        ng.gain.linearRampToValueAtTime(0.12, cursor + 0.005);
        ng.gain.linearRampToValueAtTime(0, cursor + 0.05);
        src.connect(bp).connect(ng).connect(gain);
        src.start(cursor);
        src.stop(cursor + 0.06);
      }

      cursor += syllableDur + gapDur;
    }

    gain.gain.cancelScheduledValues(t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.8, t0 + 0.04);
    gain.gain.linearRampToValueAtTime(0, tEnd + 0.05);

    window.setTimeout(() => {
      audioBoundRef.current = false;
    }, durationSec * 1000 + 100);
  };

  const stopDemo: OrbAudioController["stopDemo"] = () => {
    const gain = masterGainRef.current;
    const ctx = ctxRef.current;
    if (!gain || !ctx) return;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
    audioBoundRef.current = false;
  };

  // rAF loop — runs continuously, reads analyser when bound, otherwise
  // produces a gentle breathing baseline + Perlin-style drift so the
  // orb never looks frozen.
  useEffect(() => {
    let cancelled = false;

    function frame(now: number) {
      if (cancelled) return;
      const t = (now - startedAtRef.current) / 1000;
      const reactor = reactorRef.current;
      if (!reactor) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      let coreScale = 1.0;
      let emit = 0.5;
      let halo = 0.5;
      let cwMult = 1.0;
      let ccwMult = 1.0;
      let bandFreq: { freq: Uint8Array<ArrayBuffer>; midMax: number; hiMax: number } | null = null;

      const analyser = analyserRef.current;
      const freq = freqRef.current;
      const time = timeRef.current;

      if (analyser && freq && time && audioBoundRef.current) {
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(time);

        let sumSq = 0;
        for (let i = 0; i < time.length; i++) {
          const v = (time[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / time.length);

        const sr = ctxRef.current?.sampleRate ?? 48000;
        const binHz = sr / analyser.fftSize;
        const lowMax = Math.min(freq.length, Math.ceil(60 / binHz));
        const midMax = Math.min(freq.length, Math.ceil(2000 / binHz));
        const hiMax = Math.min(freq.length, Math.ceil(8000 / binHz));

        let lowSum = 0;
        let midSum = 0;
        let peak = 0;
        for (let i = 0; i < lowMax; i++) lowSum += freq[i];
        for (let i = lowMax; i < midMax; i++) midSum += freq[i];
        for (let i = 0; i < freq.length; i++) if (freq[i] > peak) peak = freq[i];

        const low = lowMax > 0 ? lowSum / lowMax / 255 : 0;
        const mid = midMax > lowMax ? midSum / (midMax - lowMax) / 255 : 0;
        const peakN = peak / 255;

        const breathe = 0.5 + 0.5 * Math.sin(t * 2.2);
        coreScale = 1.0 + 0.2 * Math.max(rms * 2.4, breathe * 0.12);
        emit = 0.3 + 0.5 * Math.max(peakN, breathe * 0.3);
        halo = 0.4 + 0.5 * Math.max(peakN * 0.95, breathe * 0.25);
        cwMult = 1.0 + 2.0 * low;
        ccwMult = 1.0 + 2.0 * mid;
        bandFreq = { freq, midMax, hiMax };
      } else {
        const breathe = 0.5 + 0.5 * Math.sin(t * 1.6);
        coreScale = 1.0 + breathe * 0.04;
        emit = 0.45 + breathe * 0.2;
        halo = 0.35 + breathe * 0.18;
      }

      // Two incommensurate sines approximate 1D Perlin — organic ±3px drift
      const driftX = (Math.sin(t * 0.31) + Math.sin(t * 0.197)) * 1.5;
      const driftY = (Math.sin(t * 0.27 + 1.7) + Math.sin(t * 0.213 + 0.4)) * 1.5;

      const s = reactor.style;
      s.setProperty("--orb-core-scale", coreScale.toFixed(3));
      s.setProperty("--orb-emit", emit.toFixed(3));
      s.setProperty("--orb-halo", halo.toFixed(3));
      s.setProperty("--orb-cw-mult", cwMult.toFixed(3));
      s.setProperty("--orb-ccw-mult", ccwMult.toFixed(3));
      s.setProperty("--orb-x", driftX.toFixed(2) + "px");
      s.setProperty("--orb-y", driftY.toFixed(2) + "px");

      // Tick brightness — sequential rim shimmer on idle, frequency-mapped
      // brighten on bound audio.
      const tickGroup = tickGroupRef.current;
      if (tickGroup) {
        const ticks = tickGroup.children;
        if (bandFreq) {
          const { freq: fb, midMax, hiMax } = bandFreq;
          const range = Math.max(1, hiMax - midMax);
          for (let k = 0; k < ticks.length; k++) {
            const binIdx = midMax + Math.floor((k / ticks.length) * range);
            const v = (fb[binIdx] || 0) / 255;
            const major = k % 5 === 0;
            const base = major ? 0.7 : 0.32;
            (ticks[k] as SVGLineElement).setAttribute(
              "opacity",
              Math.min(1, base + v * 1.0).toFixed(2)
            );
          }
        } else {
          const head = (t * 6) % ticks.length;
          for (let k = 0; k < ticks.length; k++) {
            const major = k % 5 === 0;
            const base = major ? 0.7 : 0.32;
            const dist = Math.abs(k - head);
            const wrap = Math.min(dist, ticks.length - dist);
            const bump = Math.max(0, 1 - wrap / 8) * 0.35;
            (ticks[k] as SVGLineElement).setAttribute(
              "opacity",
              (base + bump).toFixed(2)
            );
          }
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [reactorRef, tickGroupRef]);

  // Resume audio on first interaction — browser autoplay policy
  useEffect(() => {
    function onFirstInteract() {
      const ctx = ensureAudio();
      if (ctx && ctx.state === "suspended") ctx.resume();
    }
    window.addEventListener("pointerdown", onFirstInteract, { once: true });
    window.addEventListener("keydown", onFirstInteract, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstInteract);
      window.removeEventListener("keydown", onFirstInteract);
    };
  }, []);

  // Tear down audio graph on unmount
  useEffect(() => {
    return () => {
      try {
        activeElSourceRef.current?.disconnect();
      } catch {}
      try {
        activeStreamSourceRef.current?.disconnect();
      } catch {}
      try {
        masterGainRef.current?.disconnect();
      } catch {}
      try {
        analyserRef.current?.disconnect();
      } catch {}
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  return {
    attachStream,
    attachAudioElement,
    playDemoSpeech,
    stopDemo,
  };
}
