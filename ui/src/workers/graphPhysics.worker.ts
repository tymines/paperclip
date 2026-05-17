/**
 * graphPhysics.worker.ts
 *
 * Off-thread force-directed layout pre-warmer.
 * Runs a simple 3-D spring + repulsion simulation so the main thread receives
 * a near-converged initial layout instead of starting from random positions,
 * dramatically reducing the visible "explosion" on first load.
 *
 * Uses an O(n²) repulsion loop with a distance-cutoff that makes it behave
 * like Barnes-Hut for sparse graphs (far-away pairs contribute negligibly and
 * are skipped early).
 */

export type PhysicsInput = {
  nodeIds: string[];
  nodeTypes: string[];
  links: Array<{ source: string; target: string }>;
};

export type PhysicsOutput =
  | { type: "progress"; tick: number }
  | { type: "done"; positions: Record<string, { x: number; y: number; z: number }> };

interface SimNode {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  mass: number;
}

interface SimLink {
  a: number;
  b: number;
}

const MASS: Record<string, number> = {
  hub: 6, agent: 3, skill: 2, issue: 1, run: 0.8,
};

self.onmessage = (e: MessageEvent<PhysicsInput>) => {
  const { nodeIds, nodeTypes, links: rawLinks } = e.data;
  const N = nodeIds.length;

  if (N === 0) {
    self.postMessage({ type: "done", positions: {} } satisfies PhysicsOutput);
    return;
  }

  // ── Initialize positions on Fibonacci sphere surface ──────────────────────
  const radius = Math.max(120, N * 2.0);
  const nodes: SimNode[] = nodeIds.map((_, i) => {
    const phi = Math.acos(-1 + (2 * i) / Math.max(N - 1, 1));
    const theta = Math.sqrt(N * Math.PI) * phi;
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi),
      vx: 0, vy: 0, vz: 0,
      mass: MASS[nodeTypes[i]] ?? 1,
    };
  });

  // ── Build adjacency index ─────────────────────────────────────────────────
  const idToIdx = new Map<string, number>(nodeIds.map((id, i) => [id, i]));
  const links: SimLink[] = rawLinks
    .map(l => ({ a: idToIdx.get(l.source) ?? -1, b: idToIdx.get(l.target) ?? -1 }))
    .filter(l => l.a >= 0 && l.b >= 0);

  // ── Simulation parameters ─────────────────────────────────────────────────
  const REPULSION = 2000;
  const SPRING_K = 0.05;
  const IDEAL_LEN = 70;
  const DAMPING = 0.82;
  const DIST_MAX_SQ = 700 * 700; // skip repulsion beyond 700 units (B-H approx)
  const GRAVITY = 0.0015;
  const iters = N > 600 ? 35 : N > 300 ? 65 : N > 100 ? 110 : 160;

  // ── Simulation loop ───────────────────────────────────────────────────────
  for (let tick = 0; tick < iters; tick++) {
    // Repulsion (pairwise with distance cutoff)
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dz = nodes[j].z - nodes[i].z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        if (d2 > DIST_MAX_SQ) continue;
        const inv = REPULSION / (d2 * Math.sqrt(d2));
        const fx = dx * inv, fy = dy * inv, fz = dz * inv;
        nodes[i].vx -= fx / nodes[i].mass;
        nodes[i].vy -= fy / nodes[i].mass;
        nodes[i].vz -= fz / nodes[i].mass;
        nodes[j].vx += fx / nodes[j].mass;
        nodes[j].vy += fy / nodes[j].mass;
        nodes[j].vz += fz / nodes[j].mass;
      }
    }

    // Spring attraction along edges
    for (const { a, b } of links) {
      const dx = nodes[b].x - nodes[a].x;
      const dy = nodes[b].y - nodes[a].y;
      const dz = nodes[b].z - nodes[a].z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
      const f = SPRING_K * (dist - IDEAL_LEN) / dist;
      nodes[a].vx += dx * f; nodes[a].vy += dy * f; nodes[a].vz += dz * f;
      nodes[b].vx -= dx * f; nodes[b].vy -= dy * f; nodes[b].vz -= dz * f;
    }

    // Weak center gravity so graph doesn't drift
    for (const n of nodes) {
      n.vx -= n.x * GRAVITY;
      n.vy -= n.y * GRAVITY;
      n.vz -= n.z * GRAVITY;
    }

    // Integrate + damp
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
      n.vx *= DAMPING; n.vy *= DAMPING; n.vz *= DAMPING;
    }

    if (tick % 20 === 19) {
      self.postMessage({ type: "progress", tick: tick + 1 } satisfies PhysicsOutput);
    }
  }

  // ── Return final positions ────────────────────────────────────────────────
  const positions: Record<string, { x: number; y: number; z: number }> = {};
  nodeIds.forEach((id, i) => {
    positions[id] = { x: nodes[i].x, y: nodes[i].y, z: nodes[i].z };
  });
  self.postMessage({ type: "done", positions } satisfies PhysicsOutput);
};
