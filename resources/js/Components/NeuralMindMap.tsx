import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
    ZoomIn,
    ZoomOut,
    Maximize,
    RefreshCw,
    Search,
    X,
    Network,
    Tag,
    BookOpen,
    Power,
    ShieldCheck
} from 'lucide-react';
import { RELATION_LABEL } from '@/lib/relations';

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
    relation?: string | null;
    weight?: number | null;
    reason?: string | null;
}

interface NeuralMindMapProps {
    nodes: MindMapNode[];
    links: MindMapLink[];
    onToggleActive?: (node: MindMapNode) => void;
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

const STORAGE_KEY = 'dp-ai-neural-map-v4';
const MIN_ZOOM = 0.16;
const MAX_ZOOM = 3.4;
const NODE_H = 44;
const GRID_SIZE = 40;

function hash1(seed: number): number {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

// Compact neuron-shaped nodes — never stretch too long.
function nodeWidth(n: MindMapNode | undefined): number {
    const len = n?.title?.length || 0;
    return Math.min(152, Math.max(104, len * 6.6 + 48));
}

/* ─────────────────────────────────────────────────────────────
   Structured tree layout: each connected component becomes a
   tidy dendrogram — the busiest node is the root, related nodes
   branch out level by level to the right, and siblings stack
   cleanly one below the other. This reads like an organized
   knowledge map instead of a circular galaxy, with generous
   spacing and zero overlaps.
   $seed perturbs a tiny deterministic jitter so a "rearrange"
   refreshes the pose without ever breaking the structure.
   ───────────────────────────────────────────────────────────── */
function computeLayout(nodes: MindMapNode[], links: MindMapLink[], seed = 0): Record<number, Point> {
    const n = nodes.length;
    const result: Record<number, Point> = {};
    if (n === 0) return result;

    const nodeById = new Map(nodes.map(nd => [nd.id, nd]));
    const jitter = (id: number) => hash1(id + seed * 7919) - 0.5;

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

    // Generous, readable spacing so every memory can be analyzed comfortably.
    const COL_W = 240;   // horizontal gap between depth columns
    const ROW_H = 76;    // vertical gap between sibling slots
    const COMP_GAP = 96; // padding around each component's bounding box

    // Dendrogram of one component: root on the left, generations grow right.
    const layoutComponent = (ids: number[]) => {
        let hub = ids[0];
        ids.forEach(id => {
            if ((adj[id] || []).length > (adj[hub] || []).length) hub = id;
        });

        // BFS tree from the hub: depth, parent and ordered children (busiest
        // neighbours first so the most connected concepts sit closest to the top).
        const depth: Record<number, number> = { [hub]: 0 };
        const children: Record<number, number[]> = {};
        const queue = [hub];
        while (queue.length) {
            const cur = queue.shift()!;
            const neighbours = [...(adj[cur] || [])].sort((a, b) =>
                (adj[b]?.length || 0) - (adj[a]?.length || 0)
            );
            for (const next of neighbours) {
                if (depth[next] === undefined) {
                    depth[next] = (depth[cur] ?? 0) + 1;
                    (children[cur] ||= []).push(next);
                    queue.push(next);
                }
            }
        }

        // Post-order slot assignment: leaves take sequential rows, internal
        // nodes sit centered between their children so branches stay tidy and
        // never collide with a sibling subtree.
        const slot: Record<number, number> = {};
        let cursor = 0;
        const assignSlots = (id: number): number[] => {
            const kids = children[id] || [];
            if (kids.length === 0) {
                const s = cursor;
                cursor += 1;
                slot[id] = s;
                return [s];
            }
            const spans: number[] = [];
            kids.forEach(k => spans.push(...assignSlots(k)));
            slot[id] = (spans[0] + spans[spans.length - 1]) / 2;
            return spans;
        };
        assignSlots(hub);

        let minSlot = Infinity, maxSlot = -Infinity, maxDepth = 0;
        ids.forEach(id => {
            minSlot = Math.min(minSlot, slot[id]);
            maxSlot = Math.max(maxSlot, slot[id]);
            maxDepth = Math.max(maxDepth, depth[id] ?? 0);
        });
        const midSlot = (minSlot + maxSlot) / 2;

        const local: Record<number, Point> = {};
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        ids.forEach(id => {
            const jx = jitter(id) * 10;
            const jy = jitter(id + 3) * 6;
            const x = (depth[id] ?? 0) * COL_W + jx;
            const y = ((slot[id] ?? 0) - midSlot) * ROW_H + jy;
            local[id] = { x, y };
            const w = nodeWidth(nodeById.get(id));
            minX = Math.min(minX, x - w / 2);
            maxX = Math.max(maxX, x + w / 2);
            minY = Math.min(minY, y - NODE_H / 2);
            maxY = Math.max(maxY, y + NODE_H / 2);
        });

        return {
            ids,
            local,
            minX,
            minY,
            w: Math.max(maxX - minX, 1),
            h: Math.max(maxY - minY, 1),
        };
    };

    const compLayouts = comps.map(c => layoutComponent(c))
        .sort((a, b) => b.ids.length - a.ids.length);

    // Pack every component's bounding box left→right, wrapping into a new row
    // when a row fills up, so the whole canvas stays structured and overlap-free.
    const global: Record<number, Point> = {};
    const ROW_BUDGET = 2600;
    let curX = 0;
    let curY = 0;
    let rowMaxH = 0;
    compLayouts.forEach(comp => {
        if (curX > 0 && curX + comp.w > ROW_BUDGET) {
            curX = 0;
            curY += rowMaxH + COMP_GAP;
            rowMaxH = 0;
        }
        const dx = curX - comp.minX;
        const dy = curY - comp.minY;
        comp.ids.forEach(id => {
            global[id] = { x: comp.local[id].x + dx, y: comp.local[id].y + dy };
        });
        curX += comp.w + COMP_GAP;
        rowMaxH = Math.max(rowMaxH, comp.h);
    });

    // Belt-and-suspenders pass in case jitter ever squeezes two nodes together.
    resolveOverlaps(global, id => nodeWidth(nodeById.get(id)), NODE_H, 40);

    // Normalize into a tight world box so the structure fills the viewport.
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

/**
 * Iteratively separate every pair of overlapping nodes, treating each node as
 * a circle sized by its wider edge (width or height). Each pass pushes apart
 * half the required distance; repeated passes converge to a clean layout
 * without overlaps while keeping the overall galaxy structure intact.
 */
function resolveOverlaps(
    positions: Record<number, Point>,
    widthOf: (id: number) => number,
    height: number,
    gap: number,
    passes = 80,
): void {
    const ids = Object.keys(positions).map(Number);
    for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < ids.length; i++) {
            const a = positions[ids[i]];
            for (let j = i + 1; j < ids.length; j++) {
                const b = positions[ids[j]];
                const minD = Math.max(widthOf(ids[i]), height) / 2
                    + Math.max(widthOf(ids[j]), height) / 2
                    + gap;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.hypot(dx, dy);
                if (d < minD && d > 0.0001) {
                    const push = (minD - d) / 2;
                    const ux = dx / d;
                    const uy = dy / d;
                    a.x -= ux * push;
                    a.y -= uy * push;
                    b.x += ux * push;
                    b.y += uy * push;
                }
            }
        }
    }
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

export default function NeuralMindMap({ nodes, links, onToggleActive }: NeuralMindMapProps) {
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
    const [showLabels, setShowLabels] = useState(false);
    const [layoutSeed, setLayoutSeed] = useState(0);
    const [rearrangeTick, setRearrangeTick] = useState(0);
    const [savedPos, setSavedPos] = useState<Record<number, Point> | null>(() => loadSavedPositions());

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

    const layout = useMemo(() => computeLayout(nodes, links, layoutSeed), [nodes, links, layoutSeed]);

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

    // ── Zoom (instant & predictable, no animation races) ──────
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
        setView(fit);
    }, [computeFit]);

    // Initial "fit to world" once we know the size.
    const fittedRef = useRef(false);
    useEffect(() => {
        if (fittedRef.current || containerSize.w < 100 || nodes.length === 0) return;
        fittedRef.current = true;
        const fit = computeFit();
        if (!fit) return;
        setView(fit);
    }, [containerSize, nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Refit the cosmos onto the just-rearranged layout.
    useEffect(() => {
        if (rearrangeTick === 0) return;
        fitToView();
    }, [rearrangeTick, fitToView]);

    const rearrangeLayout = () => {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // ignore
        }
        setSavedPos(null);
        setLayoutSeed(Math.floor(Math.random() * 1_000_000));
        setRearrangeTick(t => t + 1);
    };

    const focusNode = (id: number) => {
        const p = positions[id];
        if (!p) return;
        setSelectedId(id);
        setView({
            k: clampZoom(1.25),
            x: containerSize.w / 2 - p.x * 1.25,
            y: containerSize.h / 2 - p.y * 1.25,
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
        const local = toLocal(e.clientX, e.clientY);
        zoomAt(local.x, local.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        const local = toLocal(e.clientX, e.clientY);
        if (viewRef.current.k < 1.25) {
            zoomAt(local.x, local.y, 1.8);
        } else {
            fitToView();
        }
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

    const detailRef = useRef<HTMLDivElement>(null);

    // Bring the below-the-map detail panel into view whenever a node is picked.
    useEffect(() => {
        if (selectedId === null) return;
        requestAnimationFrame(() => {
            detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }, [selectedId]);

    // Relation metadata (label/weight/reason) between the selected node and each neighbour.
    const linkInfoTo = useMemo(() => {
        const map: Record<number, MindMapLink> = {};
        if (selectedId !== null) {
            links.forEach(l => {
                if (l.source === selectedId) map[l.target] = l;
                if (l.target === selectedId) map[l.source] = l;
            });
        }
        return map;
    }, [links, selectedId]);

    const searching = searchQuery.trim().length > 0;

    return (
        <>
        <div className="relative rounded-2xl border border-border/60 bg-background overflow-hidden select-none apple-card">
            {/* Top-left: compact stats pill + standalone search pill */}
            <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-2 w-64 sm:w-80">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/85 dark:bg-card/85 backdrop-blur-xl border border-border/50 shadow-sm">
                    <Network className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-[11px] font-semibold text-foreground whitespace-nowrap">
                        {nodes.length} nodes
                    </span>
                    <span className="text-[10px] text-muted-foreground">•</span>
                    <span className="text-[11px] font-semibold text-muted-foreground truncate">
                        {links.length} synapses
                    </span>
                </div>
                <div className="flex items-center gap-2 pl-3.5 pr-1.5 h-9 w-full rounded-full bg-background/85 dark:bg-card/85 backdrop-blur-xl border border-border/50 shadow-sm focus-within:border-primary/50 transition">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Find a memory..."
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full min-w-0 h-full bg-transparent appearance-none text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                    />
                    {searching && matches.size > 0 && (
                        <span className="shrink-0 h-4 min-w-4 px-1 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center">
                            {matches.size}
                        </span>
                    )}
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="shrink-0 p-1 rounded-full text-muted-foreground hover:text-foreground transition"
                            title="Clear search"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Controls */}
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
                <button onClick={() => zoomBy(1.25)} title="Zoom in" className="w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center transition">
                    <ZoomIn className="h-4 w-4" />
                </button>
                <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out" className="w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center transition">
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
                <button onClick={rearrangeLayout} title="Rearrange layout" className="w-8 h-8 rounded-xl bg-background/85 dark:bg-card/80 backdrop-blur-xl border border-border/50 shadow-sm text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center transition">
                    <RefreshCw className="h-4 w-4" />
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
                                <circle cx="1.6" cy="1.6" r="1.2" fill="var(--border)" opacity="0.55" />
                            </pattern>
                        </defs>

                        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                            {/* Cosmic dot grid — expands with the universe */}
                            <rect x={-100000} y={-100000} width={200000} height={200000} fill="url(#dp-grid)" />

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
                                                {link.label ? ` — ${link.label}` : ''}
                                                {link.relation ? ` · ${RELATION_LABEL[link.relation] ?? link.relation}` : ''}
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

                            {/* Nodes — compact neuron capsules */}
                            {nodes.map(node => {
                                const p = positions[node.id];
                                const w = nodeWidth(nodeById[node.id]);
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
                                                className={`flex items-center gap-1.5 h-full w-full px-3 rounded-full border-[1.5px] shadow-sm transition ${
                                                    isRule
                                                        ? 'bg-primary/15 border-primary/45'
                                                        : 'bg-white dark:bg-[#1B1C1E] border-black/[0.08] dark:border-white/[0.14]'
                                                } ${!node.is_active ? 'opacity-55' : ''} ${
                                                    isSelected ? 'ring-2 ring-primary' : ''
                                                } ${isMatch ? 'ring-2 ring-primary/60' : ''} ${
                                                    dimmed ? 'opacity-25' : ''
                                                }`}
                                            >
                                                <span
                                                    className="text-[10.5px] font-semibold text-foreground leading-tight truncate"
                                                    title={node.title}
                                                >
                                                    {node.title}
                                                </span>
                                                {node.degree > 0 && (
                                                    <span className="ml-auto shrink-0 pl-1 text-[9px] font-mono text-muted-foreground bg-black/[0.05] dark:bg-white/[0.08] rounded-full px-1.5 py-0.5">
                                                        {node.degree}
                                                    </span>
                                                )}
                                            </div>
                                        </foreignObject>

                                        {/* Hit area for drag + click — relative to the translated group so it always matches the node */}
                                        <rect
                                            x={-w / 2}
                                            y={-NODE_H / 2}
                                            width={w}
                                            height={NODE_H}
                                            rx={22}
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
            </div>

        {/* Node detail — rendered BELOW the mind-map container, never covering the graph. */}
        {selectedNode && (
            <div
                ref={detailRef}
                className="rounded-2xl border border-border/60 bg-card apple-card overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-150"
            >
                <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span
                            className={`inline-flex items-center shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold tracking-wide border ${
                                selectedNode.kind === 'rule'
                                    ? 'bg-primary/10 text-primary border-primary/30'
                                    : 'bg-muted text-muted-foreground border-border'
                            }`}
                        >
                            {selectedNode.kind === 'rule' ? 'RULE' : 'NOTE'}
                        </span>
                        <h4 className="text-sm font-semibold text-foreground truncate">
                            {selectedNode.title}
                        </h4>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            onClick={() => onToggleActive?.(selectedNode)}
                            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold tracking-wider transition flex items-center gap-1 ${
                                selectedNode.is_active
                                    ? 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                    : 'bg-primary/10 text-primary hover:bg-primary/20'
                            }`}
                            title={selectedNode.is_active ? 'Pause this memory' : 'Activate this memory'}
                        >
                            <Power className="h-3 w-3" />
                            {selectedNode.is_active ? 'Pause' : 'Activate'}
                        </button>
                        <button
                            onClick={() => setSelectedId(null)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
                            title="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <p className="px-4 py-3 text-xs text-foreground/95 leading-relaxed whitespace-pre-wrap max-h-[38vh] overflow-y-auto bg-background/40 border-y border-border/40">
                    {selectedNode.content}
                </p>

                <div className="px-4 py-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <BookOpen className="h-3 w-3" />
                            {selectedNode.author_name || 'System'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            {selectedNode.kind === 'rule' && <ShieldCheck className="h-3 w-3 text-primary" />}
                            {selectedNode.kind === 'rule' ? 'Directive' : 'Knowledge'}
                        </span>
                        <span
                            className={`inline-flex items-center gap-1 ${
                                selectedNode.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                            }`}
                        >
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${selectedNode.is_active ? 'bg-emerald-500' : 'bg-destructive'}`}
                            />
                            {selectedNode.is_active ? 'Active' : 'Paused'}
                        </span>
                    </div>

                    {selectedNeighbors.length > 0 && (
                        <div className="border-t border-border/40 pt-3 space-y-2">
                            <p className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                                Synapses ({selectedNeighbors.length})
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {selectedNeighbors.map(nid => {
                                    const nb = nodeById[nid];
                                    if (!nb) return null;
                                    const link = linkInfoTo[nid];
                                    const relName = link?.relation
                                        ? RELATION_LABEL[link.relation] ?? link.relation
                                        : link?.label ?? 'Related';
                                    const w = link?.weight;
                                    return (
                                        <button
                                            key={nid}
                                            onClick={() => focusNode(nid)}
                                            title={link?.reason ?? link?.label ?? relName}
                                            className="px-2 py-1 rounded-lg border border-border/60 bg-background/70 text-[10.5px] font-medium text-foreground hover:border-primary/50 hover:text-primary transition"
                                        >
                                            {nb.title}
                                            <span className="ml-1.5 inline-flex items-center gap-1 text-[9px] font-semibold text-primary uppercase">
                                                {relName}
                                                {w !== null && w !== undefined && (
                                                    <span className="font-mono text-muted-foreground">
                                                        {Math.round(w * 100)}%
                                                    </span>
                                                )}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}
        </>
    );
}