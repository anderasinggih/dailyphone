import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
    ZoomIn,
    ZoomOut,
    Maximize,
    RotateCcw,
    Search,
    X,
    Network,
    Tag,
    BookOpen,
    Power,
    ShieldCheck
} from 'lucide-react';

interface MindMapNode {
    id: number;
    title: string;
    content: string;
    kind: 'rule' | 'knowledge';
    is_active: boolean;
    author_name: string | null;
    degree: number;
}

interface MindMapLink {
    id: number;
    source: number;
    target: number;
    label: string | null;
}

interface NeuralMindMapProps {
    nodes: MindMapNode[];
    links: MindMapLink[];
}

interface Point {
    x: number;
    y: number;
}

const STORAGE_KEY = 'dp-ai-neural-map-v1';
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 2.6;

function hash1(seed: number): number {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

// Deterministic force-directed layout over the whole graph (each connected
// cluster emerges on its own, neuron-style).
function computeLayout(nodes: MindMapNode[], links: MindMapLink[]): Record<number, Point> {
    const n = nodes.length;
    const result: Record<number, Point> = {};
    if (n === 0) return result;

    nodes.forEach((node, i) => {
        const angle = i * 2.399963 + hash1(node.id) * 6.283;
        const radius = 70 + (i % 8) * 62;
        result[node.id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });

    const adj: Record<number, number[]> = {};
    nodes.forEach(node => (adj[node.id] = []));
    links.forEach(l => {
        if (adj[l.source] && adj[l.target]) {
            adj[l.source].push(l.target);
            adj[l.target].push(l.source);
        }
    });

    const iterations = n > 400 ? 50 : n > 160 ? 110 : 190;
    const area = Math.max(1400, n * 460);
    const k = Math.sqrt(area / n);
    const repConst = k * k;

    for (let it = 0; it < iterations; it++) {
        const disp: Record<string, Point> = {};
        nodes.forEach(node => (disp[node.id] = { x: 0, y: 0 }));

        for (let i = 0; i < n; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < n; j++) {
                const b = nodes[j];
                const dx = result[a.id].x - result[b.id].x;
                const dy = result[a.id].y - result[b.id].y;
                const d2 = Math.max(dx * dx + dy * dy, 0.05);
                const f = Math.min(repConst / d2, k);
                const d = Math.sqrt(d2);
                const fx = (dx / d) * f;
                const fy = (dy / d) * f;
                disp[a.id].x += fx;
                disp[a.id].y += fy;
                disp[b.id].x -= fx;
                disp[b.id].y -= fy;
            }
        }

        links.forEach(l => {
            const p1 = result[l.source];
            const p2 = result[l.target];
            if (!p1 || !p2) return;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const d = Math.max(Math.hypot(dx, dy), 0.01);
            const f = (d * d) / (k * 7);
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            disp[l.source].x += fx;
            disp[l.source].y += fy;
            disp[l.target].x -= fx;
            disp[l.target].y -= fy;
        });

        const cooling = 0.12 * (1 - it / iterations);
        nodes.forEach(node => {
            const moving = disp[node.id];
            const d = Math.hypot(moving.x, moving.y) || 0.001;
            const step = Math.min(d, cooling * k);
            result[node.id].x += (moving.x / d) * step;
            result[node.id].y += (moving.y / d) * step;
        });
    }

    // Normalize into a tight world box so the graph fills the viewport nicely.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(node => {
        const p = result[node.id];
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    const boxW = Math.max(maxX - minX, 1);
    const boxH = Math.max(maxY - minY, 1);
    const scale = Math.min(1500 / boxW, 950 / boxH);
    nodes.forEach(node => {
        const p = result[node.id];
        p.x = (p.x - (minX + maxX) / 2) * scale;
        p.y = (p.y - (minY + maxY) / 2) * scale;
    });

    return result;
}

function loadSavedPositions(): Record<number, Point> | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return null;
    } catch {
        return null;
    }
}

export default function NeuralMindMap({ nodes, links }: NeuralMindMapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ w: 900, h: 600 });

    const [view, setView] = useState({ x: 0, y: 0, k: 1 });
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [hoveredLink, setHoveredLink] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showLabels, setShowLabels] = useState(true);
    const [layoutSeed, setLayoutSeed] = useState(0);
    const [savedPos, setSavedPos] = useState<Record<number, Point> | null>(() => loadSavedPositions());

    const [drag, setDrag] = useState<{
        kind: 'pan' | 'node';
        nodeId?: number;
        startX: number;
        startY: number;
        origin?: Point;
        viewOrigin?: { x: number; y: number };
        moved: boolean;
    } | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const layout = useMemo(() => computeLayout(nodes, links), [nodes, links, layoutSeed]);

    // Merge persisted positions with freshly computed ones for any new node.
    const positions = useMemo<Record<number, Point>>(() => {
        const merged: Record<number, Point> = {};
        nodes.forEach(node => {
            if (savedPos && savedPos[node.id] !== undefined) {
                merged[node.id] = savedPos[node.id];
            } else if (layout[node.id]) {
                merged[node.id] = layout[node.id];
            } else {
                merged[node.id] = { x: hash1(node.id) * 80 - 40, y: hash1(node.id + 7) * 80 - 40 };
            }
        });
        return merged;
    }, [nodes, layout, savedPos]);

    const persistPositions = useCallback((next: Record<number, Point>) => {
        setSavedPos(next);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // ignore quota/serialization errors
        }
    }, []);

    const nodeById = useMemo(() => {
        const map: Record<number, MindMapNode> = {};
        nodes.forEach(node => (map[node.id] = node));
        return map;
    }, [nodes]);

    const neighbors = useMemo(() => {
        const map: Record<number, Set<number>> = {};
        nodes.forEach(node => (map[node.id] = new Set()));
        links.forEach(l => {
            if (map[l.source]) map[l.source].add(l.target);
            if (map[l.target]) map[l.target].add(l.source);
        });
        return map;
    }, [nodes, links]);

    const nodeTitle = (id: number) => nodeById[id]?.title || `#${id}`;
    const nodeWidth = (title: string) => Math.min(224, Math.max(120, title.length * 8 + 54));
    const NODE_H = 44;

    // Initial "fit to world" once we know the size.
    const fittedRef = useRef(false);
    useEffect(() => {
        if (fittedRef.current || containerSize.w < 100 || nodes.length === 0) return;
        fittedRef.current = true;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(node => {
            const p = positions[node.id];
            const w = nodeWidth(nodeById[node.id]?.title || '');
            minX = Math.min(minX, p.x - w / 2 - 60);
            minY = Math.min(minY, p.y - NODE_H / 2 - 60);
            maxX = Math.max(maxX, p.x + w / 2 + 60);
            maxY = Math.max(maxY, p.y + NODE_H / 2 + 60);
        });
        const bw = Math.max(maxX - minX, 1);
        const bh = Math.max(maxY - minY, 1);
        const k = Math.min((containerSize.w - 80) / bw, (containerSize.h - 120) / bh, 1.15);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        setView({
            k: Math.max(k, MIN_ZOOM),
            x: containerSize.w / 2 - centerX * k,
            y: containerSize.h / 2 - centerY * k,
        });
    }, [containerSize, nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

    const zoomAt = (cx: number, cy: number, factor: number) => {
        setView(prev => {
            const k = clampZoom(prev.k * factor);
            const ratio = k / prev.k;
            return {
                k,
                x: cx - (cx - prev.x) * ratio,
                y: cy - (cy - prev.y) * ratio,
            };
        });
    };

    const zoomBy = (factor: number) => {
        zoomAt(containerSize.w / 2, containerSize.h / 2, factor);
    };

    const fitToView = useCallback(() => {
        fittedRef.current = true;
        if (nodes.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(node => {
            const p = positions[node.id];
            const w = nodeWidth(nodeById[node.id]?.title || '');
            minX = Math.min(minX, p.x - w / 2 - 60);
            minY = Math.min(minY, p.y - NODE_H / 2 - 60);
            maxX = Math.max(maxX, p.x + w / 2 + 60);
            maxY = Math.max(maxY, p.y + NODE_H / 2 + 60);
        });
        const bw = Math.max(maxX - minX, 1);
        const bh = Math.max(maxY - minY, 1);
        const k = Math.min((containerSize.w - 80) / bw, (containerSize.h - 120) / bh, 1.15);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        setView({
            k: Math.max(k, MIN_ZOOM),
            x: containerSize.w / 2 - centerX * k,
            y: containerSize.h / 2 - centerY * k,
        });
    }, [containerSize, nodes, positions, nodeById]);

    const resetLayout = () => {
        if (!confirm('Reset node positions to AI auto-layout?')) return;
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // ignore
        }
        setSavedPos(null);
        setLayoutSeed(s => s + 1);
    };

    const focusNode = (id: number) => {
        const p = positions[id];
        if (!p) return;
        setSelectedId(id);
        setView({
            k: clampZoom(1.1),
            x: containerSize.w / 2 - p.x * 1.1,
            y: containerSize.h / 2 - p.y * 1.1,
        });
    };

    const toLocal = (clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const matches = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return new Set<number>();
        const set = new Set<number>();
        nodes.forEach(node => {
            if (node.title.toLowerCase().includes(q) || node.content.toLowerCase().includes(q)) {
                set.add(node.id);
            }
        });
        return set;
    }, [searchQuery, nodes]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const local = toLocal(e.clientX, e.clientY);
        zoomAt(local.x, local.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };

    const handlePointerDown = (e: React.PointerEvent, nodeId?: number) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const local = toLocal(e.clientX, e.clientY);
        if (nodeId !== undefined) {
            const origin = positions[nodeId];
            setDrag({
                kind: 'node',
                nodeId,
                startX: local.x,
                startY: local.y,
                origin,
                viewOrigin: { x: view.x, y: view.y },
                moved: false,
            });
        } else {
            setDrag({
                kind: 'pan',
                startX: local.x,
                startY: local.y,
                viewOrigin: { x: view.x, y: view.y },
                moved: false,
            });
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!drag) return;
        const local = toLocal(e.clientX, e.clientY);
        const dx = local.x - drag.startX;
        const dy = local.y - drag.startY;

        if (drag.kind === 'pan' && drag.viewOrigin) {
            setView({ ...view, x: drag.viewOrigin.x + dx, y: drag.viewOrigin.y + dy });
        } else if (drag.kind === 'node' && drag.nodeId !== undefined && drag.origin && drag.viewOrigin) {
            const origin = drag.origin;
            const next = {
                ...positions,
                [drag.nodeId]: {
                    x: origin.x + dx / view.k,
                    y: origin.y + dy / view.k,
                },
            };
            setView({ x: drag.viewOrigin.x, y: drag.viewOrigin.y, k: view.k });
            persistPositions(next);
        }

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
            setDrag(prev => (prev ? { ...prev, moved: true } : prev));
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!drag) return;
        const nodeId = drag.nodeId;
        const wasClick = !drag.moved;
        if (nodeId !== undefined && wasClick) {
            setSelectedId(prev => (prev === nodeId ? null : nodeId));
        }
        setDrag(null);
    };

    const selectedNode = selectedId !== null ? nodeById[selectedId] : null;
    const selectedNeighbors = selectedNode ? Array.from(neighbors[selectedNode.id] || []) : [];

    return (
        <div className="relative rounded-2xl border border-border/60 bg-background overflow-hidden select-none apple-card">
            {/* Top-left stats + search */}
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm">
                    <Network className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-semibold text-foreground">
                        {nodes.length} nodes
                    </span>
                    <span className="text-[10px] text-muted-foreground">•</span>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                        {links.length} synapses
                    </span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm w-56">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Find a memory..."
                        className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                            title="Clear search"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Controls */}
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
                <button onClick={() => zoomBy(1.18)} title="Zoom in" className="w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center transition">
                    <ZoomIn className="h-4 w-4" />
                </button>
                <button onClick={() => zoomBy(1 / 1.18)} title="Zoom out" className="w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center transition">
                    <ZoomOut className="h-4 w-4" />
                </button>
                <button onClick={fitToView} title="Fit to view" className="w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center transition">
                    <Maximize className="h-4 w-4" />
                </button>
                <button
                    onClick={() => setShowLabels(v => !v)}
                    title="Toggle relation labels"
                    className={`w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border shadow-sm flex items-center justify-center transition ${
                        showLabels
                            ? 'border-primary/40 text-primary'
                            : 'border-border/50 text-muted-foreground hover:text-primary'
                    }`}
                >
                    <Tag className="h-4 w-4" />
                </button>
                <button onClick={resetLayout} title="Reset auto-layout" className="w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center transition">
                    <RotateCcw className="h-4 w-4" />
                </button>
            </div>

            <div
                ref={containerRef}
                className="relative w-full overflow-hidden"
                style={{ height: 'min(68vh, 720px)', touchAction: 'none', cursor: drag ? (drag.kind === 'pan' ? 'grabbing' : 'default') : 'grab' }}
                onWheel={handleWheel}
                onPointerDown={e => handlePointerDown(e)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
            >
                {nodes.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-3 px-6">
                        <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Network className="h-6 w-6 text-primary" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-foreground">No AI memory nodes yet</p>
                            <p className="text-xs text-muted-foreground max-w-sm">
                                Every time the AI learns something new in a chat, a node appears here and connects
                                itself to the related memories — forming an unlimited knowledge network.
                            </p>
                        </div>
                    </div>
                ) : (
                    <svg
                        width={containerSize.w}
                        height={containerSize.h}
                        className="block"
                        style={{ touchAction: 'none' }}
                    >
                        <defs>
                            <marker
                                id="arrow"
                                viewBox="0 0 10 10"
                                refX="8"
                                refY="5"
                                markerWidth="6"
                                markerHeight="6"
                                orient="auto-start-reverse"
                            >
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(0,122,255,0.0)" />
                            </marker>
                        </defs>

                        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                            {/* Edges */}
                            {links.map(link => {
                                const p1 = positions[link.source];
                                const p2 = positions[link.target];
                                if (!p1 || !p2) return null;
                                const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
                                const dx = x2 - x1, dy = y2 - y1;
                                const len = Math.hypot(dx, dy) || 1;
                                const off = 16 * (link.id % 2 === 0 ? 1 : -1);
                                const cx = (x1 + x2) / 2 - (dy / len) * off;
                                const cy = (y1 + y2) / 2 + (dx / len) * off;
                                const active = selectedId === link.source || selectedId === link.target;
                                const hovered = hoveredLink === link.id;

                                return (
                                    <g key={link.id}>
                                        <path
                                            d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                                            fill="none"
                                            stroke={active || hovered ? 'rgba(0,122,255,0.9)' : 'currentColor'}
                                            className={active || hovered ? '' : 'text-border'}
                                            strokeWidth={active || hovered ? 2.2 : 1.3}
                                            strokeDasharray={link.label ? 'none' : '0'}
                                            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                                            onPointerDown={e => e.stopPropagation()}
                                            onPointerEnter={() => setHoveredLink(link.id)}
                                            onPointerLeave={() => setHoveredLink(null)}
                                        >
                                            <title>
                                                {nodeTitle(link.source)} ⇄ {nodeTitle(link.target)}
                                                {link.label ? ` (${link.label})` : ''}
                                            </title>
                                        </path>

                                        {showLabels && link.label && (
                                            <text
                                                x={cx}
                                                y={cy - 6}
                                                textAnchor="middle"
                                                fontSize="11"
                                                fontWeight="600"
                                                fill={active ? '#007AFF' : 'currentColor'}
                                                className="text-muted-foreground"
                                                style={{
                                                    paintOrder: 'stroke',
                                                    stroke: 'rgba(255,255,255,0.85)',
                                                    strokeWidth: 3,
                                                    letterSpacing: 0.2,
                                                    pointerEvents: 'none',
                                                }}
                                            >
                                                {String(link.label).slice(0, 24)}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}

                            {/* Nodes */}
                            {nodes.map(node => {
                                const p = positions[node.id];
                                const w = nodeWidth(nodeById[node.id]?.title || '');
                                const x = p.x - w / 2;
                                const y = p.y - NODE_H / 2;
                                const isSelected = selectedId === node.id;
                                const isMatch = matches.size > 0 && matches.has(node.id);
                                const dimmed = matches.size > 0 && !matches.has(node.id);
                                const isRule = node.kind === 'rule';

                                return (
                                    <g key={node.id} transform={`translate(${p.x},${p.y})`}>
                                        <foreignObject
                                            x={-w / 2}
                                            y={-NODE_H / 2}
                                            width={w}
                                            height={NODE_H}
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            <div
                                                className={`flex items-center gap-1.5 h-full w-full px-2.5 rounded-xl border transition ${
                                                    isRule
                                                        ? 'bg-primary/10 border-primary/30'
                                                        : 'bg-card/90 border-border/70'
                                                } ${!node.is_active ? 'opacity-50' : ''} ${
                                                    isSelected
                                                        ? 'ring-2 ring-primary shadow-lg shadow-primary/10'
                                                        : 'shadow-xs'
                                                } ${isMatch ? 'ring-2 ring-primary/70' : ''} ${
                                                    dimmed ? 'opacity-25' : ''
                                                }`}
                                            >
                                                <span
                                                    className={`shrink-0 h-2 w-2 rounded-full ${
                                                        isRule ? 'bg-primary' : 'bg-muted-foreground/60'
                                                    }`}
                                                />
                                                <span
                                                    className="text-[11px] font-semibold text-foreground leading-tight truncate"
                                                    title={node.title}
                                                >
                                                    {node.title}
                                                </span>
                                                {node.degree > 0 && (
                                                    <span className="ml-auto shrink-0 pl-1 text-[9px] font-mono text-muted-foreground">
                                                        {node.degree}
                                                    </span>
                                                )}
                                            </div>
                                        </foreignObject>

                                        {/* Invisible hit area for drag + click */}
                                        <rect
                                            x={-w / 2}
                                            y={-NODE_H / 2}
                                            width={w}
                                            height={NODE_H}
                                            rx={10}
                                            fill="transparent"
                                            style={{ cursor: 'pointer', touchAction: 'none' }}
                                            onPointerDown={e => {
                                                e.stopPropagation();
                                                handlePointerDown(e, node.id);
                                            }}
                                        />
                                    </g>
                                );
                            })}
                        </g>
                    </svg>
                )}
            </div>

            {/* Inspector card */}
            {selectedNode && (
                <div className="absolute bottom-3 right-3 z-20 w-full max-w-sm rounded-2xl bg-card/95 dark:bg-card/90 backdrop-blur-2xl border border-border/70 shadow-2xl p-4 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <span
                                className={`inline-flex items-center shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold tracking-wide border ${
                                    selectedNode.kind === 'rule'
                                        ? 'bg-primary/10 text-primary border-primary/30'
                                        : 'bg-muted text-muted-foreground border-border'
                                }`}
                            >
                                {selectedNode.kind === 'rule' ? '[RULE]' : '[NOTE]'}
                            </span>
                            <h4 className="text-sm font-semibold text-foreground truncate">
                                {selectedNode.title}
                            </h4>
                        </div>
                        <button
                            onClick={() => setSelectedId(null)}
                            className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition shrink-0"
                            title="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto border-t border-border/40 pt-2.5">
                        {selectedNode.content}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <BookOpen className="h-3 w-3" />
                            {selectedNode.author_name}
                        </span>
                        <span className="inline-flex items-center gap-1 capitalize">
                            {selectedNode.kind === 'rule' && <ShieldCheck className="h-3 w-3 text-primary" />}
                            {selectedNode.kind === 'rule' ? 'Directive' : 'Knowledge'}
                        </span>
                        <span
                            className={`inline-flex items-center gap-1 ${selectedNode.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
                        >
                            <Power className="h-3 w-3" />
                            {selectedNode.is_active ? 'active' : 'paused'}
                        </span>
                    </div>

                    {selectedNeighbors.length > 0 && (
                        <div className="border-t border-border/40 pt-2.5 space-y-1.5">
                            <p className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                                Connected to ({selectedNeighbors.length})
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {selectedNeighbors.map(nid => {
                                    const nb = nodeById[nid];
                                    if (!nb) return null;
                                    return (
                                        <button
                                            key={nid}
                                            onClick={() => focusNode(nid)}
                                            className="px-2 py-1 rounded-lg border border-border/60 bg-background/70 text-[10.5px] font-medium text-foreground hover:border-primary/50 hover:text-primary transition"
                                        >
                                            {nb.title}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}