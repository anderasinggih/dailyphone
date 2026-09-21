export interface DiffLine {
    type: 'del' | 'add' | 'ctx';
    value: string;
    oldLine?: number;
    newLine?: number;
}

export interface DiffStats {
    additions: number;
    deletions: number;
}

const MAX_LINES = 1500;

function splitLines(text: string | null | undefined): string[] {
    const t = text ?? '';
    if (t === '') return [];
    return t.replace(/\r\n/g, '\n').split('\n');
}

export function diffStatsOf(lines: DiffLine[]): DiffStats {
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
        if (line.type === 'add') additions++;
        else if (line.type === 'del') deletions++;
    }
    return { additions, deletions };
}

/**
 * Unified line diff via LCS. A `previous_content` of null (AI-created file) is
 * diffed against nothing, producing a fully-added result — the same way
 * opencode shows brand-new files on the diff screen. Falls back to a full
 * replace for very large files to keep the allocation bounded.
 */
export function diffLines(oldText: string | null | undefined, newText: string | null | undefined): DiffLine[] {
    const a = splitLines(oldText);
    const b = splitLines(newText);

    if (a.length === 0) {
        return b.map((value, i) => ({ type: 'add' as const, value, newLine: i + 1 }));
    }
    if (b.length === 0) {
        return a.map((value, i) => ({ type: 'del' as const, value, oldLine: i + 1 }));
    }
    if (a.length > MAX_LINES || b.length > MAX_LINES) {
        return [
            ...a.map((value, i) => ({ type: 'del' as const, value, oldLine: i + 1 })),
            ...b.map((value, i) => ({ type: 'add' as const, value, newLine: i + 1 })),
        ];
    }

    const n = a.length;
    const m = b.length;
    const stride = m + 1;
    const dp = new Uint32Array((n + 1) * stride);

    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i * stride + j] = a[i] === b[j]
                ? dp[(i + 1) * stride + j + 1] + 1
                : Math.max(dp[(i + 1) * stride + j], dp[i * stride + j + 1]);
        }
    }

    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    let oldLine = 1;
    let newLine = 1;

    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ type: 'ctx', value: a[i], oldLine, newLine });
            i++;
            j++;
            oldLine++;
            newLine++;
        } else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) {
            out.push({ type: 'del', value: a[i], oldLine });
            i++;
            oldLine++;
        } else {
            out.push({ type: 'add', value: b[j], newLine });
            j++;
            newLine++;
        }
    }

    while (i < n) {
        out.push({ type: 'del', value: a[i], oldLine });
        i++;
        oldLine++;
    }
    while (j < m) {
        out.push({ type: 'add', value: b[j], newLine });
        j++;
        newLine++;
    }

    return out;
}