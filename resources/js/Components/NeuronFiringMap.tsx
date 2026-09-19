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

// Ignition pacing is eased (fast mid-run, finishing soft at the edges) so the
// energy snaps quickly and glides — never a stiff metronome.
const STEP_MIN = 150;
const STEP_MAX = 420;
const LOOP_PAUSE = 1300;

const GLOW_BLUR = '1.2';
const GLOW_FILTER = 'url(#dp-glow)';

const ACTIVE_BLUE = 'rgba(0,122,255,0.9)';
const CABLE_DIM = 'rgba(0,122,255,0.16)';
const CABLE_ONE = 'rgba(0,122,255,0.4)';
const CABLE_FULL = 'rgba(0,122,255,0.75)';
const NODE_IDLE = 'rgba(134,146,168,0.4)';

function hashSeed(id: number, salt: number): number {
    const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function easeInOutSine(t: number): number {
    return -(Math.cos(Math.PI * t) - 1) / 2;
}

function computePositions(nodes: NeuronFiringNode[]): Record<number, Point> {
    const positions: Record<number, Point> = {};
    const radius = nodes.length > 6 ? 26 : 20;
    nodes.forEach((node, i) => {
        const spread = (hashSeed(node.id, 3) - 0.5) * 7;
        const angle = i * GOLDEN;
        positions[node.id] = {
            x: Math.cos(angle) * (radius + spread),
            y: Math.sin(angle) * (radius + spread),
        };
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
    const amp = Math.min(9, dist * 0.38);
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

// Breadth-first traversal along real synapses, so the ignition visibly
// hops from neuron to neuron instead of firing in arbitrary order.
function activationOrder(nodes: NeuronFiringNode[], edges: NeuronFiringEdge[]): number[] {
    if (nodes.length === 0) return [];

    const adjacency: Record<number, Set<number>> = {};
    nodes.forEach(n => (adjacency[n.id] = new Set()));
    edges.forEach(e => {
        if (adjacency[e.source]) adjacency[e.source].add(e.target);
        if (adjacency[e.target]) adjacency[e.target].add(e.source);
    });

    const visited = new Set<number>();
    const order: number[] = [];
    const queue = [nodes[0].id];
    visited.add(nodes[0].id);

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

    const positions = useMemo(() => computePositions(shownNodes), [shownNodes]);
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

    const [frame, setFrame] = useState({ lit: 0, current: null as number | null, wipe: 0 });

    // One requestAnimationFrame loop drives the whole ignition: step timing is
    // eased and each energy pulse travels along its trace with interpolation.
    useEffect(() => {
        if (!order.length) return;

        const durations = order.map((_, i) => {
            const progress = (i + 1) / order.length;
            const ease = 1 - Math.abs(2 * progress - 1);
            return STEP_MAX - (STEP_MAX - STEP_MIN) * ease;
        });
        const timeline: number[] = [0];
        for (let i = 0; i < durations.length; i++) timeline.push(timeline[i] + durations[i]);
        const total = timeline[timeline.length - 1];

        let raf = 0;
        let cycleStart = performance.now();

        const loop = (now: number) => {
            const elapsed = now - cycleStart;

            if (elapsed >= total + LOOP_PAUSE) {
                cycleStart = now;
                setFrame({ lit: 0, current: null, wipe: 0 });
            } else if (elapsed < total) {
                let i = 0;
                while (i < timeline.length - 1 && elapsed >= timeline[i + 1]) i++;
                const stepStart = timeline[i];
                const stepDur = durations[i];
                const local = Math.min(1, (elapsed - stepStart) / stepDur);
                setFrame({ lit: i + 1, current: order[i], wipe: easeInOutSine(local) });
            } else {
                setFrame({ lit: order.length, current: null, wipe: 0 });
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [orderKey, order]);

    if (shownNodes.length === 0) return null;

    const dotRadius = shownNodes.length > 6 ? 1.6 : 1.9;
    const litSet = new Set(order.slice(0, frame.lit));
    const wipeActive = frame.current !== null && frame.wipe > 0 && frame.wipe < 1;
    const firingEdges = new Set(
        wipeActive ? shownEdges.filter(e => e.source === frame.current || e.target === frame.current) : []
    );
    // Soft fade-in/out along the pulse so each wave glides instead of slashing.
    const pulseOpacity = Math.sin(Math.PI * frame.wipe);

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
                    const sourceLit = litSet.has(edge.source);
                    const targetLit = litSet.has(edge.target);
                    const charged = Number(sourceLit) + Number(targetLit);
                    const firing = firingEdges.has(edge) && wipeActive;
                    const fromSource = frame.current === edge.source;

                    const grown = firing ? Math.max(0, frame.wipe * trace.length) : 0;

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
                            {/* White energy pulse racing along the trace. */}
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
                                        opacity={0.95 * pulseOpacity}
                                    />
                                    <circle
                                        cx={cubicPoint(
                                            fromSource ? positions[edge.source]! : positions[edge.target]!,
                                            fromSource ? trace.c1 : trace.c2,
                                            fromSource ? trace.c2 : trace.c1,
                                            fromSource ? positions[edge.target]! : positions[edge.source]!,
                                            frame.wipe
                                        ).x}
                                        cy={cubicPoint(
                                            fromSource ? positions[edge.source]! : positions[edge.target]!,
                                            fromSource ? trace.c1 : trace.c2,
                                            fromSource ? trace.c2 : trace.c1,
                                            fromSource ? positions[edge.target]! : positions[edge.source]!,
                                            frame.wipe
                                        ).y}
                                        r={1.2}
                                        fill="#ffffff"
                                        filter={GLOW_FILTER}
                                        opacity={pulseOpacity}
                                    />
                                </>
                            )}
                        </g>
                    );
                })}

                {/* Neurons: tiny dots; the firing one throws a thin white glare. */}
                {shownNodes.map(node => {
                    const p = positions[node.id];
                    if (!p) return null;
                    const lit = litSet.has(node.id);
                    const isFiring = frame.current === node.id && frame.wipe > 0;

                    return (
                        <g key={node.id}>
                            <title>{node.title}</title>
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={isFiring ? dotRadius + 0.4 + frame.wipe * 0.5 : dotRadius}
                                fill={isFiring ? '#ffffff' : lit ? ACTIVE_BLUE : NODE_IDLE}
                                filter={isFiring ? GLOW_FILTER : undefined}
                                opacity={isFiring ? 1 : lit ? 0.95 : 0.6}
                            />
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={isFiring ? dotRadius + 1.4 : dotRadius * 2}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth={0.35}
                                opacity={isFiring ? (1 - frame.wipe) * 0.5 : 0}
                            />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}