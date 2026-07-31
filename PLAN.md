# NEXUS — God-Tier MCP Server for Agentic Coding Agents

> **Mission:** Give a CLI coding agent the capabilities it structurally lacks:
> deep code understanding, change-impact awareness, persistent memory,
> engineered context, verified execution, and deterministic orchestration.

---

## 1. Research Synthesis (what elite tools do, and the gaps)

| Source | Key lesson adopted |
|---|---|
| **Aider** | Repo map = tree-sitter symbols + PageRank over reference graph, rendered into a token budget. Most important single context feature. |
| **Serena** | Symbol-level retrieval beats file-level retrieval; memory system is essential for long-lived work. |
| **Claude Code** | Tool annotations, subagent context isolation, background tasks, CLAUDE.md-style persistent memory hierarchy. |
| **Anthropic context engineering** | Context rot is real → smallest high-signal token set. Just-in-time retrieval. Compaction via externalized memory. |
| **MCP spec (draft)** | `structuredContent` + `outputSchema`, tool annotations (readOnly/destructive/idempotent/openWorld), progress notifications, cancellation, `isError` semantics. |
| **MCP security guide** | Confused-deputy, token passthrough, command injection, path traversal, scope minimization. |
| **LSP** | Definition/references/callHierarchy semantics are the gold standard for "impact analysis". |
| **Tree-sitter** | Error-tolerant incremental parsing; ERROR/MISSING nodes mean broken mid-edit code still yields partial structure. |

**The 10 structural gaps in every current coding agent (NEXUS fills all 10):**

1. Agents read raw text → **NEXUS builds a semantic symbol/reference/dependency graph**
2. Agents edit blind → **NEXUS computes blast radius before changes**
3. Agents forget everything between sessions → **NEXUS persists namespaced memory**
4. Agents fetch context greedily → **NEXUS ranks and budgets context (repo map, context packs)**
5. Agents can't verify structurally → **NEXUS parses test/lint/typecheck output into structured diagnostics**
6. Agents do serial work → **NEXUS runs deterministic parallel fan-out + persistent task DAGs**
7. Agents leak secrets / touch sensitive files → **NEXUS scans, jails, and warns**
8. Agents get huge unreadable tool dumps → **NEXUS paginates with cursors + head/tail truncation**
9. Agents lose state on crash → **NEXUS snapshots files and checkpoints task state**
10. Agents can't see the project at a glance → **NEXUS workspace health + map on demand**

---

## 2. Edge-Case Register (accounted for in design)

### 2.1 Filesystem
- **Binary detection**: NUL byte in first 8 KiB → flagged, not read as text.
- **Encodings**: UTF-8 BOM strip; UTF-16LE/BE detection via BOM → transcode; invalid UTF-8 → replacement chars (never throw).
- **Symlinks**: resolve realpath; escape-of-jail → denied; cycles → visited-set guard (max depth 40).
- **TOCTOU**: stat→read races tolerated; reads capture size before/after, truncate if grown.
- **CRLF / no-trailing-newline**: preserved verbatim on read; edits operate on line model that round-trips.
- **Case-insensitive filesystems** (macOS/Win): path comparisons use case-folded realpath on those platforms.
- **Permission errors / EPERM / ENOENT mid-walk**: walker records `skipped[]` with reasons, never aborts.
- **Windows MAX_PATH**: long-path normalization guarded; errors surfaced with hints.
- **Dotfiles**: hidden but indexable except denylist (.git internals, .env* — sensitive class).
- **gitignore**: full semantics — `!negation`, `**`, trailing-slash dir-only, per-dir .gitignore stacking, global excludes + `.git/info/exclude`.

### 2.2 Parsing / code intelligence
- **Broken code mid-edit**: error-tolerant extraction; partial symbols still emitted; `parseErrors` reported, never fatal.
- **Minified/generated files**: auto-detected (avg line length > 500 or single line > 10 KB) → skipped from index, noted.
- **Huge files**: hard cap (default 1 MB) for indexing; file still appears in map as placeholder.
- **Multi-language files** (Vue SFC, HTML+JS): segment extraction for script blocks.
- **Two parser backends behind one interface**:
  - `TreeSitterBackend` (precision; used when native modules load)
  - `LexicalBackend` (pure-JS tokenizers per language family; always available; zero native deps)
  - Backend selected per-language with graceful downgrade; identical output shape.
- **Language coverage (20)**: ts, tsx, js, jsx, mjs, cjs, py, go, rs, java, c, h, cpp, hpp, cs, rb, php, swift, kt, lua, sh.
- **Ambiguous names**: symbols keyed `file::qualname`; search returns ranked candidates with disambiguation context.
- **Dynamic calls** (function pointers, `getattr`, reflection): emitted as `dynamic` edges, excluded from exact impact, included in "possible impact".

### 2.3 Graph
- **Cycles**: Tarjan SCC condensation → DAG of components for deterministic topo order; cycles reported as units.
- **Scale**: 100k-file repos — index persisted to `.nexus/index.json.zlib`; incremental invalidation by mtime+size+hash-of-head; walker concurrency-limited (16).
- **Stale index**: every query annotates `indexAge` + `staleFiles` count; auto-refresh dirty files on read.
- **Monorepo**: multiple manifest roots detected; dependency edges resolved per-package.
### 2.4 Git
- **Not a repo / git missing / no commits (unborn HEAD) / detached HEAD / merge or rebase in progress / shallow clone / worktree (.git file) / submodule / locked index** — all detected via porcelain probes; each tool degrades with explicit `gitState` field and actionable hints instead of opaque stderr.
- **Huge diffs**: per-file stat summary first, hunks paginated; binary files flagged, never dumped.
- **CRLF diff noise**: `--ignore-cr-at-eol` fallback comparison.

### 2.5 Execution
- **Timeout kills the whole process group** (`detached` + negative PID kill on POSIX; taskkill /T on Windows) — no leaked grandchildren.
- **Interactive stdin**: stdin closed immediately; process that blocks on read gets EOF; `suspectedInteractive` heuristic in result.
- **Output volume**: ring buffer keeps first 64 KB + last 64 KB + byte count + `truncated:true`; ANSI stripped by default (`keepAnsi` opt-in).
- **Exit semantics**: `exitCode`, `signal`, `timedOut`, `durationMs` always distinct fields; 128+n signal convention decoded.
- **ENOENT (command not found)**: structured `COMMAND_NOT_FOUND` with PATH hint — MCP servers launched from GUI clients often have a barren PATH; we surface `process.env.PATH` for diagnosis.
- **Background tasks**: session registry with `poll`/`kill`/`logs`; reaped on shutdown; cap 8 concurrent.
- **Cwd deleted mid-run**: validated before spawn; error with hint.
- **Dangerous commands**: denylist patterns (`rm -rf /`, `git push --force`, `mkfs`, fork bombs) → blocked unless `allowDangerous:true` (still audit-logged).

### 2.6 Security
- **Path jail**: every file op resolves symlinks → must be under workspace root (or explicitly granted extra roots). Null bytes rejected.
- **Sensitive file classes**: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `credentials*`, `*.keystore` → reads blocked unless `allowSensitive:true`; writes always blocked.
- **Secret scanning**: 25+ detectors (AWS AKIA, GitHub ghp_/gho_, OpenAI sk-, Anthropic sk-ant, JWT, private-key headers, Slack, Stripe, generic high-entropy assignments) with entropy fallback; findings redacted in output (`AKIA****XXXX`).
- **Indirect prompt injection**: file contents and command outputs scanned for instruction-like patterns aimed at agents ("ignore previous instructions", fake system tags); result gets `INJECTION-WARNING` annotation — content delivered but flagged (inform, don't censor).
- **Command injection**: no user input is ever interpolated into shell strings; commands run as argv arrays; dangerous-op gating is allowlist-based.
- **Resource exhaustion**: caps everywhere — files walked, bytes read, output bytes, concurrent procs, memory entries, snapshot bytes.
- **Audit log**: destructive ops (restore, dangerous exec, memory forget) appended to `.nexus/audit.log` with timestamps.

### 2.7 Memory / persistence
- **Atomic writes**: tmp-file + rename; corrupt JSON → quarantined to `.corrupt-<ts>` + fresh store, never lose new writes.
- **Schema versioning**: `v` field + migration hooks.
- **Unbounded growth**: per-namespace caps (default 500 entries) + LRU eviction + byte budget (1 MB).
- **Cross-project leakage**: memories namespaced by workspace realpath hash; `global` opt-in namespace.
- **Concurrent access**: single-writer lock file with stale-lock detection (PID + mtime).

### 2.8 Protocol
- **stdio purity**: nothing but JSON-RPC on stdout; all logs to stderr (a single `console.log` breaks MCP).
- **Dual result format**: every tool returns `content` (compact human text) + `structuredContent` (typed JSON, matches declared `outputSchema`).
- **Pagination**: all list tools take `limit`+`cursor`, return `nextCursor`/`truncated` — no context blowups.
- **Progress**: long ops (index build, scans) emit `notifications/progress` when client passes `progressToken`.
- **Cancellation**: `AbortSignal` threaded through walkers/parsers; kills subprocess trees.
- **Annotations**: truthful `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` on every tool (most servers skip this — clients use it for auto-approval policy).
- **Error discipline**: expected failures → `isError:true` + `{code, message, hint}`; protocol errors reserved for protocol faults; zod-invalid input → actionable message naming the bad field.
- **Tool-description token budget**: descriptions ≤ ~60 tokens each; a `nexus_guide` resource carries the long-form playbook, loaded on demand.

### 2.9 Orchestration
- **DAG validation at submit**: Kahn cycle detection, unknown-dependency check, duplicate-id check.
- **Worker failure policy**: `fail` (default) | `retry:n` | `skip-dependents`; dependents of failed nodes marked `blocked` with reason chain.
- **Honest scope**: NEXUS orchestrates *deterministic* work (parallel analysis fan-out, batch commands, persisted task checklists that the driving agent checks off) — sub-LLM spawning is client-side; NEXUS provides the shared blackboard (task DAG + memory) that makes client-side multi-agent coordination race-free.
- **Persistence**: DAG state in `.nexus/tasks/<id>.json` — survives server restart mid-task.

---

## 3. Architecture

```
+------------------- MCP Client (CLI coding agent) -------------------+
+--------------------------- stdio JSON-RPC --------------------------+
+---------------------------- NEXUS SERVER ----------------------------+
 |  Protocol Layer   tools.ts (31 tools) - pagination - progress - dual |
|-----------------------------------------------------------------------|
|  Engines                                                              |
|   +- CodeIntel    walker -> parser backends (tree-sitter|lexical)     |
|   +- Graph        adjacency - PageRank - Tarjan SCC - impact          |
|   +- Context      repo map - token estimator - relevance - packs      |
|   +- Exec         process groups - ring buffer - bg registry          |
|   +- Verify       framework detect (jest/vitest/pytest/cargo/go/tsc)  |
|   +- Memory       namespaced KV - atomic persist - LRU caps           |
|   +- Orchestrate  DAG validate/run/persist - parallel fan-out         |
|   +- Security     path jail - sensitive classes - secret scan         |
|-----------------------------------------------------------------------|
|  Core lib     errors - fsx(safe fs) - gitignore - paths - shell - log |
|-----------------------------------------------------------------------|
|  State (.nexus/)  index.json.z - memory.jsonl - snapshots/ - tasks/   |
+-----------------------------------------------------------------------+
```

## 4. Tool Surface (31 tools, 10 families)

**A. Workspace** — 1 `nexus_workspace_overview` (languages/LOC/git/index health) · 2 `nexus_search` (regex|literal|glob|fuzzy, gitignore-aware) · 3 `nexus_read_span` (multi-range reads, encoding-safe)
**B. Code intelligence** — 4 `nexus_index_build` · 5 `nexus_file_symbols` · 6 `nexus_find_symbols` · 7 `nexus_references` · 8 `nexus_call_graph` · 9 `nexus_dependency_graph`
**C. Context engineering** — 10 `nexus_repo_map` (PageRank + token budget) · 11 `nexus_context_pack` (task-focused bundle)
**D. Change safety** — 12 `nexus_impact_analysis` · 13 `nexus_git_diff` · 14 `nexus_snapshot` / `nexus_restore`
**E. Execution & verification** — 15 `nexus_exec` · 16 `nexus_exec_poll` · 17 `nexus_test_run` (structured failures) · 18 `nexus_diagnose` (tsc/eslint/ruff → parsed diagnostics)
**F. Memory** — 19 `nexus_memory_write` · 20 `nexus_memory_search` · 21 `nexus_memory_forget`
**G. Orchestration** — 22 `nexus_task_submit` (DAG) · 23 `nexus_task_update` · 24 `nexus_task_status` · 25 `nexus_fanout` (parallel map)
**H. Security & hygiene** — 26 `nexus_secret_scan` · 27 `nexus_audit_manifest`
**I. Refactor** — 28 `nexus_rename_symbol` (preview-first, graph-scoped)
**J. Meta** — 29 `nexus_server_status` · 30 `nexus_guide` (resource + tool)

## 5. Non-negotiable quality bar

1. **Never crash**: every tool wrapped → structured error with `code/message/hint`.
2. **Never blow context**: every list paginated; every blob budgeted; every output head/tail capped.
3. **Never lie**: annotations truthful; `stale` flags honest; `dynamic` edges marked approximate.
4. **Never leak**: path jail + secret redaction + sensitive classes on by default.
5. **Never block**: index queries work off stale snapshot while refresh runs.
6. **Observability**: `--log-level`, stderr JSON logs, `.nexus/audit.log`.
7. **Zero-config start**: works on any folder; auto-detects languages, frameworks, manifests.
8. **Deterministic**: same inputs → same outputs (sorted results, seeded ranking).

## 6. Implementation order

1. Scaffold + deps + tsconfig (strict, NodeNext)
2. Core: errors, log, paths/jail, fsx, gitignore, platform shell
3. Parser layer: interface + lexical backend (20 langs) + tree-sitter backend (optional dynamic load)
4. Index: walker → extract → persist → incremental invalidation
5. Graph: build/query/PageRank/SCC/impact
6. Context: repo map + packs + token estimator
7. Exec + Verify (framework adapters + diagnostic parsers)
8. Memory + Snapshots + Audit
9. Orchestration DAG + fanout
10. Security scans
11. 30 tool registrations (zod in/out schemas, annotations, pagination)
12. Server wiring (stdio) + shutdown hygiene
13. Test client (raw JSON-RPC harness) + end-to-end validation on this repo itself
14. README + client configs + recipes

- **Barrel files / re-exports**: import graph resolves through one level of re-export.
