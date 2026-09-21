/*
 * Lightweight dependency-free code highlighter tuned for the workspace's
 * dark editor (#0b0b0d), mirroring the VS Code "Dark+" palette. Kept tiny so
 * the bundle stays lean; covers the languages the workspace actually previews.
 *
 * The tokenizer is a single linear scan (no backtracking over the whole file)
 * so rendering 1500-line files stays cheap. Multi-line strings / block
 * comments are honoured by emitting the *whole* construct as one token; callers
 * split tokens into lines with tokensToLines().
 */

export type TokenType =
    | 'comment'
    | 'string'
    | 'number'
    | 'keyword'
    | 'literal'
    | 'type'
    | 'function'
    | 'property'
    | 'tag'
    | 'attr'
    | 'selector'
    | 'variable'
    | 'operator'
    | 'plain';

export interface Token {
    type: TokenType;
    value: string;
}

export const TOKEN_CLASS: Record<TokenType, string> = {
    comment: 'tok-com',
    string: 'tok-str',
    number: 'tok-num',
    keyword: 'tok-kw',
    literal: 'tok-lit',
    type: 'tok-type',
    function: 'tok-fn',
    property: 'tok-prop',
    tag: 'tok-tag',
    attr: 'tok-attr',
    selector: 'tok-selector',
    variable: 'tok-var',
    operator: 'tok-punct',
    plain: '',
};

export const CODE_BASE = 'text-[12px] leading-[1.55] font-mono';

// ── Language keyword tables ────────────────────────────────────────────────

const KW = new Set([
    'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
    'continue', 'return', 'try', 'catch', 'finally', 'throw', 'throws', 'raise',
    'class', 'interface', 'extends', 'implements', 'enum', 'struct', 'union',
    'new', 'typeof', 'instanceof', 'in', 'of', 'with', 'yield', 'await', 'async',
    'function', 'func', 'fn', 'def', 'static', 'const', 'let', 'var', 'public',
    'private', 'protected', 'readonly', 'abstract', 'import', 'export', 'from',
    'default', 'as', 'using', 'namespace', 'module', 'require', 'package', 'declare',
    'pass', 'not', 'and', 'or', 'is', 'lambda', 'global', 'nonlocal', 'self',
    'this', 'super', 'goto', 'sizeof', 'volatile', 'register', 'extern', 'signed',
    'unsigned', 'trait', 'impl', 'match', 'move', 'ref', 'mut', 'use', 'pub',
    'crate', 'mod', 'alias', 'type', 'where', 'sealed', 'val', 'lateinit', 'init',
    'constructor', 'get', 'set', 'operator', 'companion', 'suspend', 'open',
    'final', 'override', 'native', 'synchronized', 'transient', 'strictfp',
    'unless', 'then', 'when', 'times', 'fun', 'data', 'object', 'is', 'as?',
    'nullable', 'twin', 'swift', 'extension', 'protocol', 'actor', 'nonisolated',
    'each', 'returning', 'guard', 'defer', 'repeat', 'print', 'include', 'define',
    'ifdef', 'ifndef', 'endif', 'pragma', 'undef',
]);

const LITERALS = new Set([
    'true', 'false', 'null', 'nil', 'none', 'undefined', 'true', 'false',
    'True', 'False', 'None', 'TRUE', 'FALSE', 'NULL',
]);

const PRIMITIVE_TYPES = new Set([
    'string', 'number', 'boolean', 'int', 'float', 'double', 'void', 'any',
    'unknown', 'never', 'object', 'array', 'list', 'dict', 'set', 'tuple',
    'map', 'str', 'bool', 'char', 'byte', 'short', 'long', 'bigint', 'symbol',
    'decimal', 'uint', 'ulong', 'ushort', 'sbyte', 'nullable', 'dynamic', 'var_type',
    'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64',
]);

// ── Language detection ─────────────────────────────────────────────────────

const LANG_BY_EXT: Record<string, string> = {
    ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts', mts: 'ts', cts: 'ts',
    py: 'py', pyw: 'py', ipynb: 'json',
    php: 'php',
    go: 'go', rb: 'rb', rs: 'rs', java: 'java', kt: 'java', kts: 'java',
    cs: 'cs', c: 'c', h: 'c', cpp: 'c', hpp: 'c', cc: 'c', swift: 'swift', dart: 'dart',
    lua: 'lua', pl: 'pl', r: 'r', sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh',
    ps1: 'sh', bat: 'sh', cmd: 'sh',
    sql: 'sql',
    html: 'html', htm: 'html', xml: 'html', vue: 'html', svelte: 'html', blade: 'html',
    css: 'css', scss: 'css', sass: 'css', less: 'css',
    json: 'json', jsonc: 'json', webmanifest: 'json',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini',
    env: 'ini', gitignore: 'gitignore', Makefile: 'make', makefile: 'make',
    mk: 'make', md: 'md', markdown: 'md', mdwn: 'md', txt: 'txt', log: 'txt',
    csv: 'txt', tsv: 'txt', graphql: 'graphql', gql: 'graphql', proto: 'proto',
    dockerfile: 'dockerfile', lock: 'txt', svg: 'xml',
};

export function languageFromName(name: string): string | null {
    const lower = name.toLowerCase();
    if (lower.includes('dockerfile')) return 'dockerfile';
    const ext = name.includes('.') ? lower.split('.').pop() ?? '' : lower;
    return LANG_BY_EXT[ext] ?? null;
}

interface LangConfig {
    lineComment: string | null;
    blockComment: string | null;
    tripleStrings: boolean;
    hashVariables: boolean; // PHP $var
    html: boolean;
    css: boolean;
}

function langConfig(lang: string | null | undefined): LangConfig {
    switch (lang) {
        case 'py':
            return { lineComment: '#', blockComment: null, tripleStrings: true, hashVariables: false, html: false, css: false };
        case 'php':
            return { lineComment: '//', blockComment: '/*', tripleStrings: false, hashVariables: true, html: true, css: false };
        case 'sh':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'yaml':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'toml':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'ini':
            return { lineComment: ';', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'css':
            return { lineComment: null, blockComment: '/*', tripleStrings: false, hashVariables: false, html: false, css: true };
        case 'html':
            return { lineComment: null, blockComment: '/*', tripleStrings: false, hashVariables: false, html: true, css: false };
        case 'rb':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'lua':
            return { lineComment: '--', blockComment: '--[', tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'sql':
            return { lineComment: '--', blockComment: '/*', tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'pl':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'r':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'make':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'dockerfile':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'gitignore':
            return { lineComment: '#', blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'graf':
        case 'proto':
            return { lineComment: '//', blockComment: '/*', tripleStrings: false, hashVariables: false, html: false, css: false };
        case 'md':
            return { lineComment: null, blockComment: null, tripleStrings: false, hashVariables: false, html: false, css: false };
        default:
            return { lineComment: '//', blockComment: '/*', tripleStrings: false, hashVariables: false, html: false, css: false };
    }
}

// ── Scanner ────────────────────────────────────────────────────────────────

const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$\u00C0-\uFFFF]/;

function readId(src: string, pos: number): string {
    let i = pos;
    while (i < src.length && IDENT_CHAR.test(src[i])) i++;
    return src.slice(pos, i);
}

function readNumber(src: string, pos: number): [string, number] {
    let i = pos;
    // Hex / bin / oct
    if (src[i] === '0' && /[xXbBoO]/.test(src[i + 1] ?? '')) {
        i += 2;
        while (i < src.length && /[0-9a-fA-F_]/.test(src[i])) i++;
        while (i < src.length && /[uUlLnNfF]/.test(src[i])) i++;
        return [src.slice(pos, i), i];
    }
    while (i < src.length && /[0-9_]/.test(src[i])) i++;
    if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < src.length && /[0-9_]/.test(src[i])) i++;
    }
    if (src[i] === 'e' || src[i] === 'E') {
        let j = i + 1;
        if (src[j] === '+' || src[j] === '-') j++;
        if (/[0-9]/.test(src[j] ?? '')) {
            i = j;
            while (i < src.length && /[0-9_]/.test(src[i])) i++;
        }
    }
    while (i < src.length && /[uUlLnNfFhHdD]/.test(src[i])) i++;
    return [src.slice(pos, i), i];
}

function readString(src: string, pos: number, quote: string): [string, number] {
    let i = pos;
    const len = src.length;
    if (quote.length === 3) {
        let end = src.indexOf(quote, pos + 3);
        if (end === -1) end = len;
        return [src.slice(pos, end + 3), end + 3];
    }
    i = pos + 1;
    while (i < len) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === quote) { i++; break; }
        i++;
    }
    return [src.slice(pos, i), i];
}

function classifyId(word: string, cfg: LangConfig, nextChar: string): TokenType {
    if (LITERALS.has(word)) return 'literal';
    if (KW.has(word)) return 'keyword';
    if (PRIMITIVE_TYPES.has(word)) return 'type';

    // this / type-like names
    const first = word[0];
    if (first === '$') return 'variable';

    if (cfg.hashVariables && first === '$') return 'variable';

    if (first.toUpperCase() === first && /[A-Z]/.test(first)) {
        return 'type';
    }

    if (nextChar === '(') return 'function';
    if (nextChar === ':') return 'property';

    return 'plain';
}

function classifyLiteralWord(word: string, nextChar: string): TokenType {
    const w = word.toLowerCase();
    if (w === 'true' || w === 'false' || w === 'null' || w === 'none' || w === 'nil' || w === 'undefined') return 'literal';
    if (KW.has(word)) return 'keyword';
    if (PRIMITIVE_TYPES.has(word)) return 'type';
    if (/^[A-Z]/.test(word)) return 'type';
    if (nextChar === '(') return 'function';
    if (nextChar === ':') return 'property';
    return 'plain';
}

export function tokenizeCode(source: string, lang?: string | null): Token[] {
    const cfg = langConfig(lang);
    const tokens: Token[] = [];
    const len = source.length;
    let pos = 0;

    const push = (type: TokenType, value: string) => {
        if (value === '') return;
        const last = tokens[tokens.length - 1];
        if (last && last.type === type) {
            last.value += value;
        } else {
            tokens.push({ type, value });
        }
    };

    // Fast path: plain text languages.
    if (lang === 'txt' || lang === 'md' || lang === undefined) {
        if (lang === undefined) {
            tokens.push({ type: 'plain', value: source });
        } else {
            // Markdown: highlight a few structural pieces.
            while (pos < len) {
                const lineStart = pos;
                const nl = source.indexOf('\n', pos);
                const lineEnd = nl === -1 ? len : nl + 1;
                const line = source.slice(pos, lineEnd);
                if (/^#{1,6}\s/.test(line)) {
                    const m = line.match(/^(#{1,6}\s*)/);
                    tokens.push({ type: 'property', value: m![0] });
                    tokens.push({ type: 'plain', value: line.slice(m![0].length) });
                } else if (/^```/.test(line) || /^~~~/.test(line)) {
                    tokens.push({ type: 'keyword', value: line });
                } else {
                    const strong = line.match(/^(>\s?)?[\s]*(\*\*|__)/);
                    if (strong) {
                        tokens.push({ type: 'plain', value: line });
                    } else {
                        tokens.push({ type: 'plain', value: line });
                    }
                }
                pos = lineEnd;
            }
        }
        return tokens;
    }

    while (pos < len) {
        const c = source[pos];

        // Whitespace
        if (/\s/.test(c)) {
            let i = pos;
            while (i < len && /\s/.test(source[i])) i++;
            tokens.push({ type: 'plain', value: source.slice(pos, i) });
            pos = i;
            continue;
        }

        // Line comment
        if (cfg.lineComment && source.startsWith(cfg.lineComment, pos)) {
            const nl = source.indexOf('\n', pos);
            const end = nl === -1 ? len : nl;
            push('comment', source.slice(pos, end));
            pos = end;
            continue;
        }

        // Block comment
        if (cfg.blockComment && source.startsWith(cfg.blockComment, pos)) {
            const end = source.indexOf(cfg.blockComment === '--[' ? ']--' : '*/', pos + cfg.blockComment.length);
            const stop = end === -1 ? len : end + (cfg.blockComment === '--[' ? 3 : 2);
            push('comment', source.slice(pos, stop));
            pos = stop;
            continue;
        }

        // HTML comment
        if (cfg.html && source.startsWith('<!--', pos)) {
            const end = source.indexOf('-->', pos + 4);
            const stop = end === -1 ? len : end + 3;
            push('comment', source.slice(pos, stop));
            pos = stop;
            continue;
        }

        // HTML / XML tags
        if (cfg.html && (c === '<' || c === '>')) {
            if (c === '>') {
                pos = consumeOperator(push, source, pos);
                continue;
            }
            const rest = source.slice(pos);
            const m = rest.match(/^<\/?[A-Za-z][A-Za-z0-9:._-]*/);
            if (m) {
                push('tag', m[0]);
                pos += m[0].length;
                // attributes until '>' / '/>'
                while (pos < len) {
                    while (pos < len && /\s/.test(source[pos])) pos++;
                    if (source.startsWith('/>', pos)) {
                        push('operator', '/>');
                        pos += 2;
                        break;
                    }
                    if (source[pos] === '>') {
                        push('operator', '>');
                        pos++;
                        break;
                    }
                    if (pos >= len) break;
                    const ch = source[pos];
                    if (ch === '"' || ch === "'") {
                        const [str, np] = readString(source, pos, ch);
                        push('string', str);
                        pos = np;
                    } else if (/[A-Za-z_:]/.test(ch)) {
                        const id = readId(source, pos);
                        if (id === '') { pos++; continue; }
                        if (id.startsWith(':')) push('attr', id); else push('attr', id);
                        pos += id.length;
                    } else if (ch === '=') {
                        push('operator', ch);
                        pos++;
                    } else {
                        push('operator', ch);
                        pos++;
                    }
                }
                continue;
            }
            if (source.startsWith('<!', pos) || source.startsWith('<?', pos)) {
                const end = source.indexOf('>', pos);
                const stop = end === -1 ? len : end + 1;
                push('comment', source.slice(pos, stop));
                pos = stop;
                continue;
            }
            pos = consumeOperator(push, source, pos);
            continue;
        }

        // CSS: hex colors + selectors
        if (cfg.css && c === '#') {
            const m = source.slice(pos).match(/^#(?:[0-9a-fA-F]{3,8})\b/);
            if (m) {
                push('number', m[0]);
                pos += m[0].length;
                continue;
            }
        }
        if (cfg.css && c === '.') {
            const nxt = source[pos + 1];
            if (nxt && /[A-Za-z_]/.test(nxt)) {
                const id = readId(source, pos + 1);
                push('selector', '.' + id);
                pos += 1 + id.length;
                continue;
            }
        }

        // CSS / misc @directives
        if (c === '@' && (cfg.css || lang === 'ts' || lang === 'java' || lang === 'py')) {
            const nxt = source[pos + 1];
            if (nxt && /[A-Za-z_]/.test(nxt)) {
                const id = readId(source, pos + 1);
                push('keyword', '@' + id);
                pos += 1 + id.length;
                continue;
            }
        }

        // Strings
        if (c === '"' || c === "'" || c === '`') {
            let quote = c;
            // Python triple-quoted
            if (cfg.tripleStrings && source.startsWith(c.repeat(3), pos)) {
                quote = c.repeat(3);
                const [str, np] = readString(source, pos, quote);
                const prop = isPropertyNext(source, np);
                push(prop ? 'property' : 'string', str);
                pos = np;
                continue;
            }
            const [str, np] = readString(source, pos, quote);
            const prop = isPropertyNext(source, np);
            push(prop ? 'property' : 'string', str);
            pos = np;
            continue;
        }

        // Numbers
        if (/[0-9]/.test(c)) {
            const [num, np] = readNumber(source, pos);
            push('number', num);
            pos = np;
            continue;
        }

        // Identifiers / variables
        if (IDENT_START.test(c)) {
            if (c === '$' && !cfg.hashVariables) {
                const id = readId(source, pos);
                push('plain', id);
                pos += id.length;
                continue;
            }
            const id = readId(source, pos);
            let cls: TokenType;
            if (cfg.hashVariables && id.startsWith('$')) {
                cls = classifyId(id, cfg, source[pos + id.length] ?? '');
            } else {
                let j = pos + id.length;
                while (j < len && /\s/.test(source[j])) j++;
                const nextCh = source[j] ?? '';
                const nextNext = source[j + 1] ?? '';
                const isCall = nextCh === '(';
                const isProp = nextCh === ':' && nextNext !== ':' && nextNext !== '.';
                cls = classifyId(id, cfg, isCall ? '(' : (isProp ? ':' : (source[pos + id.length] ?? '')));
                // Python str/function call with decorators aside
                if (cls === 'plain') {
                    if (c === '$') cls = 'variable';
                }
            }
            push(cls, id);
            pos += id.length;
            continue;
        }

        // Operators & punctuation
        pos = consumeOperator(push, source, pos);
    }

    return tokens;
}

type PushFn = (type: TokenType, value: string) => void;

function consumeOperator(push: PushFn, src: string, pos: number): number {
    const chunk = src.slice(pos);
    const m = chunk.match(/^(?:\+\+|--|->|=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|::|\.\.|<<|>>|\*=|\+=|-=|\/=|\|=|&=|\^=|\%=|<<=|>>=|::|\.\.\.|\.)/);
    if (m) {
        push('operator', m[0]);
        return pos + m[0].length;
    }
    push('operator', src[pos]);
    return pos + 1;
}

function isPropertyNext(src: string, np: number): boolean {
    let j = np;
    while (j < src.length && /\s/.test(src[j])) j++;
    return src[j] === ':' && src[j + 1] !== ':' && src[j + 1] !== '.';
}

/**
 * Split a token stream into per-line arrays (a token may span lines for
 * multi-line strings / block comments). Missing lines use empty arrays.
 */
export function tokensToLines(tokens: Token[]): Token[][] {
    const lines: Token[][] = [[]];
    for (const token of tokens) {
        const parts = token.value.split('\n');
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) lines.push([]);
            if (parts[i] !== '') {
                lines[lines.length - 1].push({ type: token.type, value: parts[i] });
            }
        }
    }
    return lines;
}

export function tokenCount(code: string, lang?: string | null): number {
    return tokensToLines(tokenizeCode(code, lang)).length;
}