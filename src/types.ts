/**
 * NEXUS shared type contracts — the shape every engine agrees on.
 */

// ---------------------------------------------------------------- workspace
export interface WorkspaceConfig {
  /** Absolute realpath of the workspace root (the jail boundary). */
  root: string;
  /** Extra explicitly-granted roots (symlink targets, monorepo siblings). */
  extraRoots: string[];
  /** State directory (default <root>/.nexus). */
  stateDir: string;
  /** Caps */
  maxFileBytes: number;      // indexing hard cap per file (default 1 MiB)
  maxWalkFiles: number;      // walker safety cap (default 60_000)
  maxOutputBytes: number;    // exec output head+tail budget
  maxSnapshotBytes: number;  // snapshot store cap
  maxMemoryEntries: number;  // per-namespace memory cap
  maxConcurrentExec: number; // background process cap
  respectGitignore: boolean;
  allowSensitiveReads: boolean;
}

// ---------------------------------------------------------------- symbols
export type SymbolKind =
  | 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum'
  | 'constant' | 'variable' | 'module' | 'struct' | 'trait' | 'impl'
  | 'property' | 'namespace' | 'macro' | 'unknown';

export interface SymbolInfo {
  /** Stable id: relativePath::qualifiedName */
  id: string;
  name: string;          // short name, e.g. "parseFile"
  qualname: string;      // qualified, e.g. "CodeIndex.parseFile"
  kind: SymbolKind;
  file: string;          // workspace-relative path
  startLine: number;     // 1-based
  endLine: number;
  signature?: string;    // single-line signature when extractable
  docstring?: string;    // first 400 chars of leading doc comment
  exported: boolean;
  parent?: string;       // enclosing symbol qualname
}

export interface ImportEdge {
  /** importing file (workspace-relative) */
  from: string;
  /** raw specifier as written, e.g. "./lib/fsx" or "react" */
  specifier: string;
  /** resolved workspace-relative target file, null when external/builtin */
  to: string | null;
  /** imported names if statically known */
  names: string[];
  isTypeOnly: boolean;
  isDynamic: boolean;
  line: number;
}

export interface CallSite {
  /** symbol id of the enclosing function/method (caller), if known */
  callerId: string | null;
  callerName: string;
  file: string;
  line: number;
  /** callee as written: "foo", "obj.method", "this.x" */
  calleeText: string;
  /** resolved symbol id when unambiguous, else null */
  calleeId: string | null;
  dynamic: boolean;
}

export interface FileIndex {
  file: string;
  language: string;
  sizeBytes: number;
  mtimeMs: number;
  /** first-4KB sha1 — cheap staleness signal */
  headHash: string;
  symbols: SymbolInfo[];
  imports: ImportEdge[];
  calls: CallSite[];
  parseBackend: 'lexical' | 'tree-sitter';
  parseErrors: number;
  skipped: boolean;
  skipReason?: string;
}

export interface CodeIndexSnapshot {
  version: number;
  builtAt: string;
  root: string;
  files: Record<string, FileIndex>;
  stats: {
    fileCount: number;
    indexedCount: number;
    skippedCount: number;
    symbolCount: number;
    edgeCount: number;
    durationMs: number;
  };
}

// ---------------------------------------------------------------- diagnostics
export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: 'error' | 'warning' | 'info';
  source: string;       // tsc | eslint | pytest | cargo | go | ruff ...
  code?: string;        // rule / error code
  message: string;
}

export interface TestFailure {
  name: string;
  file?: string;
  line?: number;
  message: string;
  snippet?: string;
}

// ---------------------------------------------------------------- pagination
export interface Page<T> {
  items: T[];
  total: number;
  truncated: boolean;
  nextCursor?: string;
}

export function paginate<T>(all: T[], limit: number, cursor?: string): Page<T> {
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const safeLimit = Math.max(1, Math.min(limit || 50, 500));
  const items = all.slice(start, start + safeLimit);
  const next = start + safeLimit;
  const page: Page<T> = {
    items,
    total: all.length,
    truncated: next < all.length,
  };
  if (next < all.length) page.nextCursor = String(next);
  return page;
}

/** Rough token estimate: ~4 chars/token for code (conservative). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
