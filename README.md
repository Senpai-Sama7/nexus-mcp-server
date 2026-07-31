# NEXUS — God-Tier MCP Server for Agentic Coding Agents

**The most powerful, advanced, and robust MCP server for CLI coding agents.**

NEXUS gives your AI coding agent capabilities it structurally lacks:
deep code understanding, change-impact awareness, persistent memory,
engineered context, verified execution, and deterministic orchestration.

> **31 tools · 10 families · 20+ languages · zero native dependencies**

---

## Why NEXUS?

Every current coding agent has 10 structural gaps. NEXUS fills all 10:

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

## Install

```bash
git clone <this repo>
cd nexus-mcp-server
npm install
npm run build
```

The server is now at `dist/server.js`. Configure your MCP client to launch it.

---

## MCP Client Configuration

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)
```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["/path/to/nexus-mcp-server/dist/server.js"],
      "env": { "NEXUS_WORKSPACE": "/path/to/your/project", "NEXUS_LOG_LEVEL": "info" }
    }
  }
}
```

### Claude Code / Cline (`.mcp.json` in your project root)
```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["./nexus-mcp-server/dist/server.js"],
      "env": { "NEXUS_WORKSPACE": "${workspaceFolder}" }
    }
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NEXUS_WORKSPACE` | `process.cwd()` | Workspace root (the jail boundary) |
| `NEXUS_LOG_LEVEL` | `info` | One of: `debug`, `info`, `warn`, `error`, `silent` |

---

## The 31 Tools

### A. Workspace (3)
- `nexus_workspace_overview` — languages, LOC, git state, index health
- `nexus_search` — regex/literal/glob content search
- `nexus_read_span` — line-range read with encoding + injection detection

### B. Code Intelligence (6)
- `nexus_index_build` — build/refresh the code index
- `nexus_file_symbols` — symbol outline of a file
- `nexus_find_symbols` — fuzzy workspace-wide symbol search
- `nexus_references` — all reference sites of a symbol
- `nexus_call_graph` — callers/callees, depth-N
- `nexus_dependency_graph` — import graph: deps / dependents

### C. Context Engineering (2) ⭐
- `nexus_repo_map` — **ranked repo map within a token budget** (Aider-style)
- `nexus_context_pack` — task-focused context bundle

### D. Change Safety (4)
- `nexus_impact_analysis` — blast radius before editing
- `nexus_git_diff` — smart diff with stats + paginated hunks
- `nexus_snapshot` / `nexus_restore` — checkpoint and rollback

### E. Execution & Verification (4)
- `nexus_exec` — run commands with timeout + secret redaction
- `nexus_exec_poll` — poll/kill background jobs
- `nexus_test_run` — detect framework (jest/vitest/pytest/cargo/go) → structured failures
- `nexus_diagnose` — tsc/eslint → parsed `{file, line, col, severity, rule, message}`

### F. Memory (3)
- `nexus_memory_write` / `nexus_memory_search` / `nexus_memory_forget` — persistent knowledge

### G. Orchestration (4)
- `nexus_task_submit` / `nexus_task_update` / `nexus_task_status` — DAG task management
- `nexus_fanout` — parallel map with concurrency limit

### H. Security & Hygiene (2)
- `nexus_secret_scan` — scan for AWS/GitHub/OpenAI/JWT/keys
- `nexus_audit_manifest` — dependency risk heuristics (typosquat, unpinned)

### I. Refactor (1)
- `nexus_rename_symbol` — preview-first, graph-scoped rename

### J. Meta (2)
- `nexus_server_status` — self-diagnostics
- `nexus_guide` — on-demand playbook for workflows

---

## Recommended Workflows

### New Feature
```
1. nexus_workspace_overview
2. nexus_repo_map
3. nexus_context_pack focusFiles:[...]
4. nexus_dependency_graph file:...
5. nexus_snapshot (checkpoint)
6. Implement (using nexus_read_span, nexus_search)
7. nexus_test_run + nexus_diagnose
8. nexus_secret_scan
9. nexus_memory_write (record decisions)
```

### Refactor
```
1. nexus_index_build force:true
2. nexus_find_symbols name:"oldName"
3. nexus_impact_analysis target:"oldName" mode:"symbol"
4. nexus_snapshot
5. nexus_rename_symbol (preview!)
6. nexus_test_run
```

### Debug
```
1. nexus_diagnose
2. nexus_test_run
3. nexus_search pattern:"error message"
4. nexus_call_graph symbol:... direction:callers
5. nexus_memory_write (record the fix)
```

---

## Architecture Highlights

- **Zero native dependencies** — pure JS regex-based parser works on any platform
- **20+ languages supported** — TS/JS/Python/Go/Rust/Java/C/C++/C#/Ruby/PHP/Swift/Kotlin/Lua/Shell/...
- **Path jail** — every file op goes through symlink-resolved boundary check
- **Sensitive file protection** — `.env`, keys, credentials blocked by default
- **Indirect prompt injection guard** — file contents/command outputs scanned for attack patterns
- **Secret redaction** — 15+ detectors (AWS, GitHub, OpenAI, Anthropic, JWT, etc.)
- **Process-group kill** — timeouts kill entire process trees, no leaks
- **Atomic persistence** — tmp-file + rename for index, memory, snapshots
- **LRU memory caps** — never unbounded growth
- **Tool annotations** — truthful `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`

---

## Testing

```bash
npm run test:client
```

Validates all 31 tools via the full JSON-RPC protocol end-to-end. **100% pass rate.**

---

## License

MIT
