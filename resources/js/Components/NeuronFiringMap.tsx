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

const GOLDEN = 2.39996323;
const STEP_MS = 260;

function hashSeed(id: number, salt: number): number {
    const x = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function computePositions(nodes: NeuronFiringNode[]): Record<number, Point> {
    const positions: Record<number, Point> = {};
    nodes.forEach((node, i) => {
        const radius = nodes.length > 8 ? 40 : 34;
        const spread = (hashSeed(node.id, 3) - 0.5) * 14;
        const angle = i * GOLDEN;
        positions[node.id] = {
            x: Math.cos(angle) * (radius + spread),
            y: Math.sin(angle) * (radius + spread),
        };
    });
    return positions;
}

// Breadth-first traversal from the first grabbed neuron, so the ignition
// visibly spreads along real synapses instead of firing in arbitrary order.
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

    // Orphan nodes (no synapses among the accessed set) ignite last.
    nodes.forEach(n => {
        if (!visited.has(n.id)) {
            visited.add(n.id);
            order.push(n.id);
        }
    });

    return order;
}

export default function NeuronFiringMap({ nodes, edges }: { nodes: NeuronFiringNode[]; edges: NeuronFiringEdge[] }) {
    const positions = useMemo(() => computePositions(nodes), [nodes]);
    const order = useMemo(() => activationOrder(nodes, edges), [nodes, edges]);
    const orderKey = order.join(',');

    const [tick, setTick] = useState(0);

    // Restart the ignition sequence whenever the accessed network changes.
    useEffect(() => {
        setTick(0);
    }, [orderKey]);

    useEffect(() => {
        if (!order.length) return;
        const interval = setInterval(() => {
            setTick(t => (t + 1 > order.length ? 0 : t + 1));
        }, STEP_MS);
        return () => clearInterval(interval);
    }, [orderKey, order.length]);

    const litSet = useMemo(() => new Set(order.slice(0, tick)), [order, tick]);
    const currentId = tick > 0 ? order[tick - 1] : null;

    if (nodes.length === 0) return null;

    const dotRadius = nodes.length > 10 ? 2.6 : 3.2;

    const edgePath = (source: Point, target: Point, idx: number) => {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = (idx % 2 === 0 ? 1 : -1) * 6;
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const cx = midX - (dy / len) * off;
        const cy = midY + (dx / len) * off;
        return `M ${source.x} ${source.y} Q ${cx} ${cy} ${target.x} ${target.y}`;
    };

    return (
        <div className="w-full max-w-[240px]">
            <svg viewBox="-72 -72 144 144" className="block w-full" style={{ overflow: 'visible' }}>
                <style>{`
                    @keyframes dp-neuron-flow { to { stroke-dashoffset: -42; } }
                    @keyframes dp-neuron-halo { 0%, 100% { opacity: 0.18; } 50% { opacity: 0.7; } }
                `}</style>

                {edges.map((edge, idx) => {
                    const source = positions[edge.source];
                    const target = positions[edge.target];
                    if (!source || !target) return null;
                    const sourceLit = litSet.has(edge.source);
                    const targetLit = litSet.has(edge.target);
                    const lit = Number(sourceLit) + Number(targetLit);
                    const stroke = lit > 0 ? '#007AFF' : 'var(--border)';
                    const opacity = lit === 2 ? 0.9 : lit === 1 ? 0.55 : 0.4;

                    return (
                        <path
                            key={`${edge.source}-${edge.target}`}
                            d={edgePath(source, target, idx)}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={lit === 2 ? 1.6 : 1}
                            strokeLinecap="round"
                            strokeDasharray="3 12"
                            opacity={opacity}
                            style={{
                                animation: `dp-neuron-flow ${lit === 2 ? 0.85 : 1.4}s linear infinite`,
                            }}
                        />
                    );
                })}

                {nodes.map(node => {
                    const p = positions[node.id];
                    if (!p) return null;
                    const lit = litSet.has(node.id);
                    const isCurrent = currentId === node.id;

                    return (
                        <g key={node.id}>
                            <title>{node.title}</title>
                            {isCurrent && (
                                <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={dotRadius + 3.2}
                                    fill="rgba(0,122,255,0.14)"
                                    style={{ animation: 'dp-neuron-halo 1s ease-in-out infinite' }}
                                />
                            )}
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={dotRadius}
                                fill={lit ? '#007AFF' : 'var(--border)'}
                                opacity={lit ? 1 : 0.45}
                            />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}