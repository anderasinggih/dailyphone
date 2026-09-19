import { useEffect, useMemo, useState } from 'react';

interface NeuronFiringNode {
    id: number;
    title: string;
    kind: 'rule' | 'knowledge';
}

interface NeuronFiringEdge {
    source: number;
    target: number;
}

interface Point {
    x: number;
    y: number;
}

interface Trace {
    d: string;
    reverse: string;
    c1: Point;
    c2: Point;
    length: number;
}

const GOLDEN = 2.39996323;

// Keep the circuit airy: a compact slice of the accessed network is drawn.
const MAX_NODES = 9;

// Ignition pacing: fast, snapping mid-pulses and slightly softer at the edges.
// The next neuron starts while the previous pulse is still travelling (OVERLAP),
// so the web ripples as one continuous cascading wave instead of a metronome.
const STEP_MIN = 100;
const STEP_MAX = 260;
const OVERLAP = 0.64;
const LOOP_PAUSE = 850;

const GLOW_BLUR = '1.2';
const GLOW_FILTER = 'url(#dp-glow)';

const ACTIVE_BLUE = 'rgba(0,122,255,0.9)';
const CABLE_DIM = 'rgba(0,122,255,0.16)';
const CABLE_ONE = 'rgba(0,122,255,0.4)';
const CABLE_FULL = 'rgba(0,122,255,0.75)';
const NODE_IDLE = 'rgba(134,146,168,0.4)';
const NODE_SATELLITE = 'rgba(134,146,168,0.22)';

function hashSeed(id: number, salt: number): number {
    const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function smootherstep(t: number): number {
    const x = Math.min(1, Math.max(0, t));
    return x * x * x * (x * (x * 6 - 15) + 10);
}

// Split the nodes into weakly-connected components using the real synapses, so
// the brain is laid out as one cohesive core plus (rare) idle satellites —
// never a meaningless scatter of unrelated dots pretending to be connected.
function connectedComponents(
    nodeIds: number[],
    edges: NeuronFiringEdge[]
): number[][] {
    const adj: Record<number, Set<number>> = {};
    nodeIds.forEach(id => (adj[id] = new Set()));
    edges.forEach(e => {
        if (adj[e.source]) adj[e.source].add(e.target);
        if (adj[e.target]) adj[e.target].add(e.source);
    });

    const seen = new Set<number>();
    const comps: number[][] = [];
    for (const id of nodeIds) {
        if (seen.has(id)) continue;
        const stack = [id];
        seen.add(id);
        const comp: number[] = [];
        while (stack.length) {
            const cur = stack.pop()!;
            comp.push(cur);
            for (const nb of adj[cur]) {
                if (!seen.has(nb)) {
                    seen.add(nb);
                    stack.push(nb);
                }
            }
        }
        comps.push(comp);
    }
    return comps;
}

// A tiny galaxy per component (hub at the center, neighbors on depth rings),
// then every galaxy is packed on a golden spiral — main core at the heart,
// satellites pushed to the rim so they visually read as "offline".
function computePositions(nodes: NeuronFiringNode[], edges: NeuronFiringEdge[]): Record<number, Point> {
    const positions: Record<number, Point> = {};
    const ids = nodes.map(n => n.id);
    const degree: Record<number, number> = {};
    ids.forEach(id => (degree[id] = edges.filter(e => e.source === id || e.target === id).length));

    const comps = connectedComponents(ids, edges).sort((a, b) => b.length - a.length);

    const placeComponent = (comp: number[]): Record<number, Point> => {
        const adj: Record<number, Set<number>> = {};
        comp.forEach(id => (adj[id] = new Set()));
        comp.forEach(id => {
            edges.forEach(e => {
                if (e.source === id && adj[e.target]) adj[id].add(e.target);
                if (e.target === id && adj[e.source]) adj[id].add(e.source);
            });
        });

        let hub = comp[0]!;
        comp.forEach(id => {
            if (degree[id] > (degree[hub] ?? 0)) hub = id;
        });

        const depth: Record<number, number> = { [hub]: 0 };
        const queue = [hub];
        while (queue.length) {
            const cur = queue.shift()!;
            for (const nb of adj[cur]) {
                if (depth[nb] === undefined) {
                    depth[nb] = (depth[cur] ?? 0) + 1;
                    queue.push(nb);
                }
            }
        }

        const byDepth: Record<number, number[]> = {};
        comp.forEach(id => (byDepth[depth[id] ?? 0] ||= []).push(id));

        const points: Record<number, Point> = { [hub]: { x: 0, y: 0 } };
        Object.keys(byDepth).forEach(ds => {
            const d = +ds;
            const ring = byDepth[d]!;
            ring.forEach((id, i) => {
                if (id === hub) return;
                const angle = d * 1.33 + (i * 2 * Math.PI) / ring.length;
                const r = 5.2 * d + 1;
                const jx = (hashSeed(id, 3) - 0.5) * 2.4;
                const jy = (hashSeed(id, 5) - 0.5) * 2.4;
                points[id] = { x: Math.cos(angle) * r + jx, y: Math.sin(angle) * r + jy };
            });
        });
        return points;
    };

    // Pack: pivot core at the origin, the rest fanning out along a golden spiral.
    comps.forEach((comp, ci) => {
        const points = placeComponent(comp);
        let cx = 0;
        let cy = 0;
        if (ci > 0) {
            const isSingle = comp.length === 1;
            // Keep lone satellites at the rim, clearly detached from the core.
            cx = Math.cos(ci * GOLDEN) * (isSingle ? 40 : 17 + 5.6 * ci);
            cy = Math.sin(ci * GOLDEN) * (isSingle ? 40 : 17 + 5.6 * ci);
        }
        comp.forEach(id => {
            const p = points[id];
            positions[id] = p ? { x: p.x + cx, y: p.y + cy } : { x: cx, y: cy };
        });
    });

    // Normalize so every node sits comfortably inside the viewBox (-52..52).
    const xs = Object.values(positions).map(p => p.x);
    const ys = Object.values(positions).map(p => p.y);
    const minX = Math.min(...xs, -40);
    const maxX = Math.max(...xs, 40);
    const minY = Math.min(...ys, -40);
    const maxY = Math.max(...ys, 40);
    const scale = Math.min(88 / (maxX - minX), 88 / (maxY - minY));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    ids.forEach(id => {
        const p = positions[id];
        positions[id] = { x: (p.x - cx) * scale, y: (p.y - cy) * scale };
    });

    return positions;
}

// Swooping S-curves between neurons — circuit traces rather than straight
// wires. Each connection sweeps to a distinct side so the web stays legible.
function traceFrom(a: Point, b: Point, salt: number): { c1: Point; c2: Point; d: string } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const amp = Math.min(6, dist * 0.34);
    const s1 = salt % 2 === 0 ? 1 : -1;
    const s2 = -s1;
    const push = dist * 0.12;
    const c1 = {
        x: a.x + (-uy) * amp * s1 + ux * push,
        y: a.y + ux * amp * s1 + uy * push,
    };
    const c2 = {
        x: b.x + (-uy) * amp * s2 - ux * push,
        y: b.y + ux * amp * s2 - uy * push,
    };
    const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y} ${b.x} ${b.y}`;
    return { c1, c2, d };
}

function cubicPoint(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
    const mt = 1 - t;
    return {
        x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
        y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y,
    };
}

function measureLength(a: Point, c1: Point, c2: Point, b: Point, samples = 56): number {
    let prev = cubicPoint(a, c1, c2, b, 0);
    let total = 0;
    for (let i = 1; i <= samples; i++) {
        const next = cubicPoint(a, c1, c2, b, i / samples);
        total += Math.hypot(next.x - prev.x, next.y - prev.y);
        prev = next;
    }
    return total;
}

// Breadth-first traversal along real synapses from the strongest hub, so the
// ignition visibly hops neuron to neuron along the wires.
function activationOrder(nodes: NeuronFiringNode[], edges: NeuronFiringEdge[]): number[] {
    if (nodes.length === 0) return [];

    const adjacency: Record<number, Set<number>> = {};
    nodes.forEach(n => (adjacency[n.id] = new Set()));
    edges.forEach(e => {
        if (adjacency[e.source]) adjacency[e.source].add(e.target);
        if (adjacency[e.target]) adjacency[e.target].add(e.source);
    });

    // Start from the hub with the most synapses so the cascade follows the core.
    let start = nodes[0].id;
    nodes.forEach(n => {
        if ((adjacency[n.id]?.size ?? 0) > (adjacency[start]?.size ?? 0)) start = n.id;
    });

    const visited = new Set<number>();
    const order: number[] = [];
    const queue = [start];
    visited.add(start);

    while (queue.length) {
        const current = queue.shift()!;
        order.push(current);
        for (const neighbour of adjacency[current] ?? new Set<number>()) {
            if (!visited.has(neighbour)) {
                visited.add(neighbour);
                queue.push(neighbour);
            }
        }
    }

    nodes.forEach(n => {
        if (!visited.has(n.id)) {
            visited.add(n.id);
            order.push(n.id);
        }
    });

    return order;
}

export default function NeuronFiringMap({ nodes, edges }: { nodes: NeuronFiringNode[]; edges: NeuronFiringEdge[] }) {
    const shownNodes = useMemo(() => nodes.slice(0, MAX_NODES), [nodes]);
    const shownIds = useMemo(() => new Set(shownNodes.map(n => n.id)), [shownNodes]);
    const shownEdges = useMemo(
        () => edges.filter(e => shownIds.has(e.source) && shownIds.has(e.target)),
        [edges, shownIds]
    );

    // Which nodes are actually part of the neural core (have at least one wire)?
    const coreIds = useMemo(() => {
        const s = new Set<number>();
        shownEdges.forEach(e => {
            s.add(e.source);
            s.add(e.target);
        });
        return s;
    }, [shownEdges]);

    const positions = useMemo(() => computePositions(shownNodes, shownEdges), [shownNodes, shownEdges]);
    const order = useMemo(() => activationOrder(shownNodes, shownEdges), [shownNodes, shownEdges]);
    const orderKey = order.join(',');

    const traces = useMemo(() => {
        const map: Record<string, Trace> = {};
        shownEdges.forEach((edge, idx) => {
            const source = positions[edge.source];
            const target = positions[edge.target];
            if (!source || !target) return;
            const { c1, c2, d } = traceFrom(source, target, idx);
            const reverse = `M ${target.x} ${target.y} C ${c2.x} ${c2.y}, ${c1.x} ${c1.y} ${source.x} ${source.y}`;
            map[`${edge.source}-${edge.target}`] = {
                d,
                reverse,
                c1,
                c2,
                length: measureLength(source, c1, c2, target),
            };
        });
        return map;
    }, [shownEdges, positions]);

    // progress[i] = how far neuron order[i] has travelled (0 → 1) this cycle.
    const [frame, setFrame] = useState<{ prog: Record<number, number> }>({ prog: {} });

    useEffect(() => {
        if (!order.length) return;

        const durations = order.map((_, i) => {
            const progress = (i + 1) / order.length;
            const ease = 1 - Math.abs(2 * progress - 1);
            return STEP_MAX - (STEP_MAX - STEP_MIN) * ease;
        });
        // Overlapping cascade: the next neuron ignites before the previous pulse
        // finishes, so waves chase each other along the wires.
        const starts: number[] = [];
        let t = 0;
        for (let i = 0; i < durations.length; i++) {
            starts.push(t);
            t += durations[i] * OVERLAP;
        }
        const total = starts[durations.length - 1] + durations[durations.length - 1];

        let raf = 0;
        let cycleStart = performance.now();

        const loop = (now: number) => {
            const elapsed = now - cycleStart;

            if (elapsed >= total + LOOP_PAUSE) {
                cycleStart = now;
                setFrame({ prog: {} });
            } else if (elapsed < total) {
                const prog: Record<number, number> = {};
                for (let i = 0; i < order.length; i++) {
                    if (elapsed < starts[i]) break;
                    const id = order[i];
                    const local = Math.min(1, (elapsed - starts[i]) / durations[i]);
                    const hidden = local <= 0.02;
                    prog[id] = hidden ? 0 : smootherstep(local);
                }
                setFrame({ prog });
            } else {
                const full: Record<number, number> = {};
                order.forEach(id => (full[id] = 1));
                setFrame({ prog: full });
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [orderKey, order]);

    if (shownNodes.length === 0) return null;

    const dotRadius = shownNodes.length > 6 ? 1.6 : 1.9;
    const isMid = (id: number) => {
        const p = frame.prog[id];
        return p !== undefined && p > 0 && p < 1;
    };

    return (
        <div className="w-full max-w-[190px]">
            <svg viewBox="-52 -52 104 104" className="block w-full" style={{ overflow: 'visible' }}>
                <style>{`@keyframes dp-flow { to { stroke-dashoffset: -14; } }`}</style>
                <defs>
                    <filter id="dp-glow" x="-80%" y="-80%" width="260%" height="260%">
                        <feGaussianBlur stdDeviation={GLOW_BLUR} result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Traces: whisper-thin blue circuit lines; they charge up as
                    their endpoints light, never white */}
                {shownEdges.map((edge, idx) => {
                    const trace = traces[`${edge.source}-${edge.target}`];
                    if (!trace) return null;
                    const srcP = frame.prog[edge.source] ?? 0;
                    const tgtP = frame.prog[edge.target] ?? 0;
                    const srcMid = srcP > 0 && srcP < 1;
                    const tgtMid = tgtP > 0 && tgtP < 1;
                    const charged = (srcP > 0 ? 1 : 0) + (tgtP > 0 ? 1 : 0);
                    const firing = srcMid || tgtMid;
                    const fromSource = srcMid ? true : !tgtMid;
                    const wipe = srcMid ? srcP : tgtP;

                    const grown = firing && wipe ? Math.max(0, wipe * trace.length) : 0;

                    return (
                        <g key={`${edge.source}-${edge.target}`}>
                            <path
                                d={trace.d}
                                fill="none"
                                stroke={charged === 2 ? CABLE_FULL : charged === 1 ? CABLE_ONE : CABLE_DIM}
                                strokeWidth={charged === 2 ? 0.7 : charged === 1 ? 0.55 : 0.4}
                                strokeLinecap="round"
                                opacity={charged === 0 ? 0.75 : 1}
                            />
                            {/* Fully connected traces carry a slow stream of energy,
                                so the lit web visibly hums as one network. */}
                            {charged === 2 && (
                                <path
                                    d={trace.d}
                                    fill="none"
                                    stroke="rgba(168,214,255,0.55)"
                                    strokeWidth={0.6}
                                    strokeLinecap="round"
                                    strokeDasharray="1.5 6"
                                    opacity={0.5}
                                    style={{ animation: 'dp-flow 1100ms linear infinite' }}
                                />
                            )}
                            {/* White energy pulses racing along the trace — several
                                can travel at once when the cascade overlaps. */}
                            {grown > 0 && (
                                <>
                                    <path
                                        d={fromSource ? trace.d : trace.reverse}
                                        fill="none"
                                        stroke="#ffffff"
                                        strokeWidth={0.9}
                                        strokeLinecap="round"
                                        strokeDasharray={`${grown.toFixed(2)} ${trace.length.toFixed(2)}`}
                                        filter={GLOW_FILTER}
                                        opacity={0.95 * Math.sin(Math.PI * Math.min(1, wipe))}
                                        style={{ pointerEvents: 'none' }}
                                    />
                                    <circle
                                        cx={cubicPoint(
                                            fromSource ? positions[edge.source]! : positions[edge.target]!,
                                            fromSource ? trace.c1 : trace.c2,
                                            fromSource ? trace.c2 : trace.c1,
                                            fromSource ? positions[edge.target]! : positions[edge.source]!,
                                            wipe
                                        ).x}
                                        cy={cubicPoint(
                                            fromSource ? positions[edge.source]! : positions[edge.target]!,
                                            fromSource ? trace.c1 : trace.c2,
                                            fromSource ? trace.c2 : trace.c1,
                                            fromSource ? positions[edge.target]! : positions[edge.source]!,
                                            wipe
                                        ).y}
                                        r={1.2}
                                        fill="#ffffff"
                                        filter={GLOW_FILTER}
                                        opacity={Math.sin(Math.PI * Math.min(1, wipe))}
                                        style={{ pointerEvents: 'none' }}
                                    />
                                </>
                            )}
                        </g>
                    );
                })}

                {/* Neurons: tiny dots; firing ones throw a thin white glare. */}
                {shownNodes.map(node => {
                    const p = positions[node.id];
                    if (!p) return null;
                    const inCore = coreIds.has(node.id);
                    const prog = frame.prog[node.id] ?? 0;
                    const lit = prog > 0;
                    const firing = isMid(node.id);

                    // Satellites (no synapse in the drawn slice) stay calm and
                    // faint on the rim — present, but clearly outside the live core.
                    if (!inCore) {
                        return (
                            <g key={node.id}>
                                <title>{node.title}</title>
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={dotRadius * 0.8}
                                    fill={NODE_SATELLITE}
                                    opacity={0.5}
                                />
                            </g>
                        );
                    }

                    return (
                        <g key={node.id}>
                            <title>{node.title}</title>
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={firing ? dotRadius + 0.4 + frame.prog[node.id]! * 0.5 : dotRadius}
                                fill={firing ? '#ffffff' : lit ? ACTIVE_BLUE : NODE_IDLE}
                                filter={firing ? GLOW_FILTER : undefined}
                                opacity={firing ? 1 : lit ? 0.95 : 0.6}
                            />
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={firing ? dotRadius + 1.4 : dotRadius * 2}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth={0.35}
                                opacity={firing ? (1 - frame.prog[node.id]!) * 0.5 : 0}
                            />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}