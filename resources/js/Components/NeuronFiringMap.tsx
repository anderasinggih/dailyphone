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

interface Curve {
    d: string;
    reverse: string;
    control: Point;
    length: number;
}

const GOLDEN = 2.39996323;

// Cap the displayed network so the map stays airy instead of crowded.
const MAX_NODES = 9;

// Ignition timing is intentionally non-linear: fast in the middle of the run,
// easing to a slower crawl at either end — like a pulse that accelerates.
const STEP_MIN = 220;
const STEP_MAX = 620;
const LOOP_PAUSE = 1500;

const SVG_GLOW = 'url(#dp-glow)';
const GLOW_WIDTH = '2';

function hashSeed(id: number, salt: number): number {
    const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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

function curveFrom(a: Point, b: Point, salt: number): { control: Point; d: string } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = (salt % 2 === 0 ? 1 : -1) * 5;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const control = {
        x: midX - (dy / len) * off,
        y: midY + (dx / len) * off,
    };
    const d = `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`;
    return { control, d };
}

function quadPoint(a: Point, c: Point, b: Point, t: number): Point {
    const mt = 1 - t;
    return {
        x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
        y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
    };
}

function measureLength(a: Point, c: Point, b: Point, samples = 48): number {
    let prev = quadPoint(a, c, b, 0);
    let total = 0;
    for (let i = 1; i <= samples; i++) {
        const next = quadPoint(a, c, b, i / samples);
        total += Math.hypot(next.x - prev.x, next.y - prev.y);
        prev = next;
    }
    return total;
}

// Breadth-first traversal along real synapses, so the ignition visibly
// spreads from neuron to neuron instead of firing in arbitrary order.
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
    // Only a compact slice of the accessed network is drawn so the animation
    // stays a tasteful murmur rather than a wall of dots.
    const shownNodes = useMemo(() => nodes.slice(0, MAX_NODES), [nodes]);
    const shownIds = useMemo(() => new Set(shownNodes.map(n => n.id)), [shownNodes]);
    const shownEdges = useMemo(
        () => edges.filter(e => shownIds.has(e.source) && shownIds.has(e.target)),
        [edges, shownIds]
    );

    const positions = useMemo(() => computePositions(shownNodes), [shownNodes]);
    const order = useMemo(() => activationOrder(shownNodes, shownEdges), [shownNodes, shownEdges]);
    const orderKey = order.join(',');

    const curves = useMemo(() => {
        const map: Record<string, Curve> = {};
        shownEdges.forEach((edge, idx) => {
            const source = positions[edge.source];
            const target = positions[edge.target];
            if (!source || !target) return;
            const { control, d } = curveFrom(source, target, idx);
            const reverse = `M ${target.x} ${target.y} Q ${control.x} ${control.y} ${source.x} ${source.y}`;
            map[`${edge.source}-${edge.target}`] = {
                d,
                reverse,
                control,
                length: measureLength(source, control, target),
            };
        });
        return map;
    }, [shownEdges, positions]);

    const [frame, setFrame] = useState({ lit: 0, current: null as number | null, wipe: 0 });

    // One requestAnimationFrame loop drives the whole ignition: step timing is
    // eased (fast mid-run, slow at the ends) and each glow-wipe travels along
    // its cable with easeInOut interpolation instead of a constant speed.
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
                setFrame({ lit: i + 1, current: order[i], wipe: easeInOutCubic(local) });
            } else {
                setFrame({ lit: order.length, current: null, wipe: 0 });
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [orderKey, order]);

    if (shownNodes.length === 0) return null;

    const dotRadius = shownNodes.length > 6 ? 2 : 2.3;
    const litSet = new Set(order.slice(0, frame.lit));
    const wipeActive = frame.current !== null && frame.wipe > 0 && frame.wipe < 1;
    const firingEdges = wipeActive
        ? shownEdges.filter(e => e.source === frame.current || e.target === frame.current)
        : [];

    return (
        <div className="w-full max-w-[190px]">
            <svg viewBox="-52 -52 104 104" className="block w-full" style={{ overflow: 'visible' }}>
                <defs>
                    <filter id="dp-glow" x="-80%" y="-80%" width="260%" height="260%">
                        <feGaussianBlur stdDeviation={GLOW_WIDTH} result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Cables: thin, quiet, and always blue — never white. */}
                {shownEdges.map((edge, idx) => {
                    const curve = curves[`${edge.source}-${edge.target}`];
                    if (!curve) return null;
                    const sourceLit = litSet.has(edge.source);
                    const targetLit = litSet.has(edge.target);
                    const lit = Number(sourceLit) + Number(targetLit);
                    const firing = firingEdges.includes(edge);
                    const fromSource = frame.current === edge.source;

                    const grown = wipeActive && firing ? Math.max(0, frame.wipe * curve.length) : 0;

                    return (
                        <g key={`${edge.source}-${edge.target}`}>
                            <path
                                d={curve.d}
                                fill="none"
                                stroke={lit > 0 ? 'rgba(0,122,255,0.75)' : 'rgba(0,122,255,0.25)'}
                                strokeWidth={lit > 0 ? 1 : 0.7}
                                strokeLinecap="round"
                                opacity={lit > 0 ? 0.9 : 0.6}
                            />
                            {/* White glow-wipe growing from the firing neuron outward. */}
                            {grown > 0 && (
                                <>
                                    <path
                                        d={fromSource ? curve.d : curve.reverse}
                                        fill="none"
                                        stroke="#ffffff"
                                        strokeWidth={1.4}
                                        strokeLinecap="round"
                                        strokeDasharray={`${grown.toFixed(2)} ${curve.length.toFixed(2)}`}
                                        filter={SVG_GLOW}
                                        opacity={0.95}
                                    />
                                    <circle
                                        cx={quadPoint(
                                            fromSource ? positions[edge.source]! : positions[edge.target]!,
                                            curve.control,
                                            fromSource ? positions[edge.target]! : positions[edge.source]!,
                                            frame.wipe
                                        ).x}
                                        cy={quadPoint(
                                            fromSource ? positions[edge.source]! : positions[edge.target]!,
                                            curve.control,
                                            fromSource ? positions[edge.target]! : positions[edge.source]!,
                                            frame.wipe
                                        ).y}
                                        r={1.9}
                                        fill="#ffffff"
                                        filter={SVG_GLOW}
                                    />
                                </>
                            )}
                        </g>
                    );
                })}

                {/* Neurons: small dots; the firing one throws a blinding white flash. */}
                {shownNodes.map(node => {
                    const p = positions[node.id];
                    if (!p) return null;
                    const lit = litSet.has(node.id);
                    const isFiring = frame.current === node.id && frame.wipe > 0;

                    return (
                        <g key={node.id}>
                            <title>{node.title}</title>
                            {isFiring && (
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={dotRadius * (1 + frame.wipe * 2.6)}
                                    fill="none"
                                    stroke="#ffffff"
                                    strokeWidth={0.9}
                                    filter={SVG_GLOW}
                                    opacity={(1 - frame.wipe) * 0.85}
                                />
                            )}
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={isFiring ? dotRadius + 0.5 : dotRadius}
                                fill={isFiring ? '#ffffff' : lit ? '#007AFF' : 'rgba(134,146,168,0.5)'}
                                filter={isFiring ? SVG_GLOW : undefined}
                                opacity={isFiring ? 1 : lit ? 0.95 : 0.55}
                            />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}