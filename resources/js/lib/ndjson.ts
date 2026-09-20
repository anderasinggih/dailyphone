// Shared consumer for the Assistant's application/x-ndjson streaming endpoint.
// Emitted by AiAssistantController@chat: 'neurons' (retrieved neuron network,
// each node tagged with its retrieval stage / seed order), 'chunk' (token
// deltas), 'trace' (node ids the model actually cited), 'learned' (ingest
// feedback) and the final 'done' / 'error' event.

export interface StreamNeuron {
    id: number;
    title: string;
    kind: string;
    stage?: string;
    order?: number;
    sources?: string[];
}

export interface StreamEdge {
    source: number;
    target: number;
}

export interface NdjsonEvent {
    type: string;
    [key: string]: any;
}

export interface NdjsonHandlers {
    onNeurons?: (nodes: StreamNeuron[], edges: StreamEdge[]) => void;
    onToken?: (text: string) => void;
    onTrace?: (used: number[]) => void;
    onLearned?: (payload: NdjsonEvent) => void;
    onStage?: (stage: string, nodes: StreamNeuron[]) => void;
}

export async function consumeNdjson(
    res: Response,
    handlers: NdjsonHandlers
): Promise<NdjsonEvent | null> {
    if (!res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let last: NdjsonEvent | null = null;

    const digest = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: NdjsonEvent | null = null;
        try {
            evt = JSON.parse(trimmed);
        } catch {
            return;
        }
        if (!evt || typeof evt !== 'object') return;

        if (evt.type === 'neurons' && handlers.onNeurons) {
            handlers.onNeurons(
                Array.isArray(evt.nodes) ? evt.nodes : [],
                Array.isArray(evt.edges) ? evt.edges : []
            );
        }
        if (evt.type === 'stage' && handlers.onStage && typeof evt.stage === 'string' && Array.isArray(evt.nodes)) {
            handlers.onStage(evt.stage, evt.nodes);
        }
        if (evt.type === 'chunk' && handlers.onToken && typeof evt.text === 'string') {
            handlers.onToken(evt.text);
        }
        if (evt.type === 'trace' && handlers.onTrace && Array.isArray(evt.used)) {
            handlers.onTrace(evt.used.map(Number).filter((n: number) => Number.isFinite(n) && n > 0));
        }
        if (evt.type === 'learned' && handlers.onLearned) {
            handlers.onLearned(evt);
        }
        if (evt.type === 'done' || evt.type === 'error') {
            last = evt;
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            digest(line);
        }
    }
    if (buffer.trim()) {
        digest(buffer);
    }
    return last;
}