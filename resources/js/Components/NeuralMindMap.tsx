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

interface View {
    x: number;
    y: number;
    k: number;
}

const STORAGE_KEY = 'dp-ai-neural-map-v2';
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 3.2;
const ELASTIC = 0.5;
const NODE_H = 44;
const GRID_SIZE = 40;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function hash1(seed: number): number {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function nodeWidth(n: MindMapNode | undefined): number {
    const len = n?.title?.length || 0;
    const hub = n ? Math.min(n.degree || 0, 6) * 9 : 0;
    return Math.min(248, Math.max(118, len * 7.6 + 58 + hub));
}

/* ─────────────────────────────────────────────────────────────
   Galaxy layout: each connected component becomes a small
   galaxy (hub at the center, memories on depth rings), then
   every galaxy is packed into a larger cosmos.
   ───────────────────────────────────────────────────────────── */
function computeLayout(nodes: MindMapNode[], links: MindMapLink[]): Record<number, Point> {
    const n = nodes.length;
    const result: Record<number, Point> = {};
    if (n === 0) return result;

    const nodeById = new Map(nodes.map(nd => [nd.id, nd]));

    const adj: Record<number, number[]> = {};
    nodes.forEach(nd => (adj[nd.id] = []));
    links.forEach(l => {
        if (adj[l.source] && adj[l.target]) {
            adj[l.source].push(l.target);
            adj[l.target].push(l.source);
        }
    });

    // Connected components
    const compOf: Record<number, number> = {};
    const comps: number[][] = [];
    nodes.forEach(nd => {
        if (compOf[nd.id] !== undefined) return;
        const stack = [nd.id];
        const comp: number[] = [];
        compOf[nd.id] = comps.length;
        while (stack.length) {
            const cur = stack.pop()!;
            comp.push(cur);
            for (const nb of adj[cur]) {
                if (compOf[nb] === undefined) {
                    compOf[nb] = comps.length;
                    stack.push(nb);
                }
            }
        }
        comps.push(comp);
    });

    const layoutComponent = (ids: number[]) => {
        let hub = ids[0];
        ids.forEach(id => {
            if ((adj[id] || []).length > (adj[hub] || []).length) hub = id;
        });

        const depth: Record<number, number> = { [hub]: 0 };
        const queue = [hub];
        while (queue.length) {
            const cur = queue.shift()!;
            for (const nb of adj[cur] || []) {
                if (depth[nb] === undefined) {
                    depth[nb] = (depth[cur] ?? 0) + 1;
                    queue.push(nb);
                }
            }
        }

        const byDepth: Record<string, number[]> = {};
        ids.forEach(id => {
            const d = depth[id] ?? 0;
            (byDepth[d] ||= []).push(id);
        });

        const pos: Record<number, Point> = {};
        const base = 92;
        const spacing = 122;

        Object.keys(byDepth).forEach(ds => {
            const d = +ds;
            const ring = byDepth[ds];
            const avgW = ring.reduce((s, id) => s + nodeWidth(nodeById.get(id)), 0) / ring.length;
            const ringR = Math.max(base + d * spacing, (ring.length * Math.max(avgW, 150) * 1.18) / (2 * Math.PI));
            ring.forEach((id, i) => {
                const jx = (hash1(id) - 0.5) * 30;
                const jy = (hash1(id + 3) - 0.5) * 30;
                const ang = d * 1.618 + (i * 2 * Math.PI) / ring.length;
                pos[id] = { x: Math.cos(ang) * ringR + jx, y: Math.sin(ang) * ringR + jy };
            });
        });

        let radius = 0;
        const offsets: Point[] = [];
        ids.forEach(id => {
            const p = pos[id];
            offsets.push(p);
            const w = nodeWidth(nodeById.get(id));
            radius = Math.max(radius, Math.hypot(p.x, p.y) + w / 2 + 44);
        });
        return { ids, offsets, radius: Math.max(radius, 120) };
    };

    const compLayouts = comps.map(c => layoutComponent(c));

    // Galaxy packing: largest galaxy at the center, the rest on a golden spiral.
    const sorted = compLayouts
        .map((c, i) => ({ ...c, count: c.ids.length, index: i }))
        .sort((a, b) => b.count - a.count);
    const placed: { x: number; y: number; r: number }[] = [];
    const global: Record<number, Point> = {};
    const golden = 2.39996323;

    sorted.forEach((comp, i) => {
        let cx = 0;
        let cy = 0;
        if (i === 0) {
            cx = 0;
            cy = 0;
        } else {
            const angle = i * golden;
            let r = comp.radius + 120;
            const step = 110;
            let guard = 0;
            while (guard++ < 400) {
                let ok = true;
                for (const p of placed) {
                    const d = Math.hypot(Math.cos(angle) * r - p.x, Math.sin(angle) * r - p.y);
                    if (d < p.r + comp.radius + 130) {
                        ok = false;
                        break;
                    }
                }
                if (ok) break;
                r += step;
            }
            cx = Math.cos(angle) * r;
            cy = Math.sin(angle) * r;
        }
        placed.push({ x: cx, y: cy, r: comp.radius });
        comp.offsets.forEach((p, idx) => {
            global[comp.ids[idx]] = { x: p.x + cx, y: p.y + cy };
        });
    });

    // Normalize into a tight world box so the cosmos fills the viewport.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(node => {
        const p = global[node.id];
        const w = nodeWidth(node);
        minX = Math.min(minX, p.x - w / 2);
        minY = Math.min(minY, p.y - NODE_H / 2);
        maxX = Math.max(maxX, p.x + w / 2);
        maxY = Math.max(maxY, p.y + NODE_H / 2);
    });
    const boxW = Math.max(maxX - minX, 1);
    const boxH = Math.max(maxY - minY, 1);
    const scale = Math.min(1700 / boxW, 1040 / boxH);
    nodes.forEach(node => {
        const p = global[node.id];
        result[node.id] = {
            x: (p.x - (minX + maxX) / 2) * scale,
            y: (p.y - (minY + maxY) / 2) * scale,
        };
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

    const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
    const viewRef = useRef(view);
    useEffect(() => {
        viewRef.current = view;
    }, [view]);

    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [hoveredLink, setHoveredLink] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showLabels, setShowLabels] = useState(true);
    const [layoutSeed, setLayoutSeed] = useState(0);
    const [savedPos, setSavedPos] = useState<Record<number, Point> | null>(() => loadSavedPositions());

    const animRef = useRef<{ raf: number } | null>(null);

    const [drag, setDrag] = useState<{
        kind: 'pan' | 'node';
        nodeId?: number;
        startX: number;
        startY: number;
        origin?: Point;
        viewOrigin?: View;
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

    // ── Animated / elastic zoom ────────────────────────────────
    const animateZoom = useCallback((target: View, dur: number) => {
        if (animRef.current) cancelAnimationFrame(animRef.current.raf);
        const from = { ...viewRef.current };
        const start = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / dur);
            const e = easeOutCubic(t);
            const next: View = {
                k: from.k + (target.k - from.k) * e,
                x: from.x + (target.x - from.x) * e,
                y: from.y + (target.y - from.y) * e,
            };
            setView(next);
            viewRef.current = next;
            if (t < 1) raf = requestAnimationFrame(tick);
            else animRef.current = null;
        };
        animRef.current = { raf };
        raf = requestAnimationFrame(tick);
    }, []);

    // Rubber-band zoom: overshoot past the limits slightly, then spring back.
    const flexZoomPoint = useCallback(
        (cx: number, cy: number, factor: number) => {
            const prev = viewRef.current;
            const tk = prev.k * factor;
            const lo = MIN_ZOOM - ELASTIC;
            const hi = MAX_ZOOM + ELASTIC;
            const bK = Math.min(hi, Math.max(lo, tk));
            const ratio = bK / prev.k;
            const target: View = { k: bK, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
            animateZoom(target, 250);
            if (tk > MAX_ZOOM || tk < MIN_ZOOM) {
                const cK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, tk));
                const cr = cK / prev.k;
                window.setTimeout(() => {
                    animateZoom({ k: cK, x: cx - (cx - prev.x) * cr, y: cy - (cy - prev.y) * cr }, 200);
                }, 300);
            }
        },
        [animateZoom]
    );

    const zoomBy = (factor: number) => {
        flexZoomPoint(containerSize.w / 2, containerSize.h / 2, factor);
    };

    const computeFit = useCallback(() => {
        if (nodes.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(node => {
            const p = positions[node.id];
            const w = nodeWidth(nodeById[node.id]);
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
        return { k: Math.max(k, MIN_ZOOM), x: containerSize.w / 2 - centerX * k, y: containerSize.h / 2 - centerY * k };
    }, [containerSize, nodes, positions, nodeById]);

    const fitToView = useCallback(() => {
        const fit = computeFit();
        if (!fit) return;
        animateZoom(fit, 320);
    }, [computeFit, animateZoom]);

    // Initial "fit to world" once we know the size.
    const fittedRef = useRef(false);
    useEffect(() => {
        if (fittedRef.current || containerSize.w < 100 || nodes.length === 0) return;
        fittedRef.current = true;
        const fit = computeFit();
        if (!fit) return;
        setView(fit);
    }, [containerSize, nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
        animateZoom({ k: 1.1, x: containerSize.w / 2 - p.x * 1.1, y: containerSize.h / 2 - p.y * 1.1 }, 300);
    };

    const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

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
        flexZoomPoint(local.x, local.y, e.deltaY < 0 ? 1.14 : 1 / 1.14);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        const local = toLocal(e.clientX, e.clientY);
        if (viewRef.current.k < 1.25) {
            flexZoomPoint(local.x, local.y, 1.9);
        } else {
            fitToView();
        }
    };

    const handlePointerDown = (e: React.PointerEvent, nodeId?: number) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (animRef.current) {
            cancelAnimationFrame(animRef.current.raf);
            animRef.current = null;
        }
        const local = toLocal(e.clientX, e.clientY);
        if (nodeId !== undefined) {
            const origin = positions[nodeId];
            setDrag({
                kind: 'node',
                nodeId,
                startX: local.x,
                startY: local.y,
                origin,
                viewOrigin: { ...viewRef.current },
                moved: false,
            });
        } else {
            setDrag({
                kind: 'pan',
                startX: local.x,
                startY: local.y,
                viewOrigin: { ...viewRef.current },
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
            setView({
                ...drag.viewOrigin,
                x: drag.viewOrigin.x + dx,
                y: drag.viewOrigin.y + dy,
            });
        } else if (drag.kind === 'node' && drag.nodeId !== undefined && drag.origin && drag.viewOrigin) {
            const k = drag.viewOrigin.k;
            const next = {
                ...positions,
                [drag.nodeId]: {
                    x: drag.origin.x + dx / k,
                    y: drag.origin.y + dy / k,
                },
            };
            setView({ ...drag.viewOrigin });
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

    const searching = searchQuery.trim().length > 0;

    return (
        <div className="relative rounded-2xl border border-border/60 bg-background overflow-hidden select-none apple-card">
            {/* Top-left: stats + search */}
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm">
                    <Network className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-semibold text-foreground">
                        {nodes.length} nodes
                    </span>
                    <span className="text-[10px] text-muted-foreground">•</span>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                        {links.length} synapses
                    </span>
                </div>
                <div className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-background/90 dark:bg-card/90 backdrop-blur-xl border border-border/60 shadow-sm w-64 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Find a memory..."
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full h-5 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
                    />
                    {searching && matches.size > 0 && (
                        <span className="shrink-0 h-4 min-w-4 px-1 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center">
                            {matches.size}
                        </span>
                    )}
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition shrink-0"
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
                className="relative w-full overflow-hidden bg-gradient-to-br from-[#F2F3F5] to-[#E8EAEE] dark:from-[#141516] dark:to-[#0A0B0D]"
                style={{ height: 'min(68vh, 720px)', touchAction: 'none', cursor: drag ? (drag.kind === 'pan' ? 'grabbing' : 'default') : 'grab' }}
                onWheel={handleWheel}
                onDoubleClick={handleDoubleClick}
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
                            <pattern id="dp-grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                                <circle cx="1.6" cy="1.6" r="1.3" fill="var(--border)" opacity="0.6" />
                            </pattern>
                        </defs>

                        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                            {/* Cosmic dot grid — expands with the universe */}
                            <rect x={-400000} y={-400000} width={800000} height={800000} fill="url(#dp-grid)" />

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
                                        {active && (
                                            <path
                                                d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                                                fill="none"
                                                stroke="#007AFF"
                                                strokeWidth={6}
                                                opacity={0.14}
                                            />
                                        )}
                                        <path
                                            d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                                            fill="none"
                                            stroke={active || hovered ? '#007AFF' : 'currentColor'}
                                            className={active || hovered ? '' : 'text-border'}
                                            strokeWidth={active || hovered ? 2.4 : 1.4}
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
                                                    stroke: 'color-mix(in srgb, var(--background) 88%, transparent)',
                                                    strokeWidth: 3.5,
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
                                const w = nodeWidth(nodeById[node.id]);
                                const x = p.x - w / 2;
                                const y = p.y - NODE_H / 2;
                                const isSelected = selectedId === node.id;
                                const isMatch = matches.size > 0 && matches.has(node.id);
                                const dimmed = matches.size > 0 && !matches.has(node.id);
                                const isRule = node.kind === 'rule';
                                const isHub = node.degree >= 2;
                                const glowR = Math.max(w / 2 + 14, 46);

                                return (
                                    <g key={node.id} transform={`translate(${p.x},${p.y})`}>
                                        {(isSelected || isHub) && (
                                            <circle
                                                r={glowR}
                                                fill={isSelected ? 'rgba(0,122,255,0.12)' : 'rgba(0,122,255,0.05)'}
                                            />
                                        )}
                                        <foreignObject
                                            x={-w / 2}
                                            y={-NODE_H / 2}
                                            width={w}
                                            height={NODE_H}
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            <div
                                                className={`group flex items-center gap-1.5 h-full w-full px-2.5 rounded-xl border-[1.5px] transition ${
                                                    isRule
                                                        ? 'bg-primary/15 border-primary/45 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_6px_18px_-6px_rgba(0,122,255,0.45)] hover:border-primary/70'
                                                        : 'bg-white dark:bg-[#1B1C1E] border-black/[0.08] dark:border-white/[0.14] shadow-[0_1px_2px_rgba(0,0,0,0.10),0_6px_16px_-4px_rgba(0,0,0,0.22)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.55)] hover:border-primary/40'
                                                } ${!node.is_active ? 'opacity-55' : ''} ${
                                                    isSelected ? 'ring-2 ring-primary' : ''
                                                } ${isMatch ? 'ring-2 ring-primary/60' : ''} ${
                                                    dimmed ? 'opacity-25' : ''
                                                }`}
                                            >
                                                <span
                                                    className={`shrink-0 h-2 w-2 rounded-full transition ${
                                                        isRule
                                                            ? 'bg-primary shadow-[0_0_0_3px_rgba(0,122,255,0.18)]'
                                                            : 'bg-muted-foreground/60 group-hover:bg-primary'
                                                    }`}
                                                />
                                                <span
                                                    className="text-[11px] font-semibold text-foreground leading-tight truncate"
                                                    title={node.title}
                                                >
                                                    {node.title}
                                                </span>
                                                {node.degree > 0 && (
                                                    <span className="ml-auto shrink-0 pl-1 text-[9px] font-mono text-muted-foreground bg-black/[0.05] dark:bg-white/[0.08] rounded-md px-1 py-0.5">
                                                        {node.degree}
                                                    </span>
                                                )}
                                            </div>
                                        </foreignObject>

                                        {/* Invisible hit area for drag + click */}
                                        <rect
                                            x={x}
                                            y={y}
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