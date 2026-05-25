import { useMemo } from "react";

/**
 * Arc-reactor SVG centerpiece. All animation and amplitude binding
 * happens via CSS custom properties on the wrapping `.jarvis-reactor`
 * (set by useOrbAudio). This component is purely structural.
 */
export function Reactor() {
  const ticks = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    const cx = 100;
    const cy = 100;
    const rOuter = 96;
    const rInner = 90;
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const major = i % 5 === 0;
      const r1 = rOuter;
      const r2 = major ? rInner - 2 : rInner + 2;
      out.push({
        x1: cx + Math.cos(angle) * r1,
        y1: cy + Math.sin(angle) * r1,
        x2: cx + Math.cos(angle) * r2,
        y2: cy + Math.sin(angle) * r2,
        major,
      });
    }
    return out;
  }, []);

  return (
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <radialGradient id="jarvis-core-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e6f9ff" />
          <stop offset="45%" stopColor="#00d4ff" />
          <stop offset="100%" stopColor="#003c66" />
        </radialGradient>
        <radialGradient id="jarvis-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#00d4ff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="jarvis-halo" cx="50%" cy="50%" r="50%">
          <stop offset="40%" stopColor="#00d4ff" stopOpacity="0" />
          <stop offset="70%" stopColor="#00d4ff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle className="jarvis-halo" cx={100} cy={100} r={95} />

      <g opacity={0.7} data-tick-group>
        {ticks.map((t, i) => (
          <line
            key={i}
            className="jarvis-tick"
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            opacity={t.major ? 0.7 : 0.32}
          />
        ))}
      </g>

      <circle className="jarvis-ring r4" cx={100} cy={100} r={86} />
      <circle className="jarvis-ring r2" cx={100} cy={100} r={72} />
      <circle className="jarvis-ring r1" cx={100} cy={100} r={58} />
      <circle className="jarvis-ring r3" cx={100} cy={100} r={44} />

      <line className="jarvis-scanline" x1={100} y1={100} x2={100} y2={14} />

      <circle className="jarvis-ripple rp1" cx={100} cy={100} r={32} />
      <circle className="jarvis-ripple rp2" cx={100} cy={100} r={32} />
      <circle className="jarvis-ripple rp3" cx={100} cy={100} r={32} />

      <circle className="jarvis-core-glow" cx={100} cy={100} r={34} />
      <circle className="jarvis-core" cx={100} cy={100} r={20} />

      <g opacity={0.35}>
        <line x1={100} y1={6} x2={100} y2={22} className="jarvis-tick" />
        <line x1={100} y1={178} x2={100} y2={194} className="jarvis-tick" />
        <line x1={6} y1={100} x2={22} y2={100} className="jarvis-tick" />
        <line x1={178} y1={100} x2={194} y2={100} className="jarvis-tick" />
      </g>
    </svg>
  );
}
