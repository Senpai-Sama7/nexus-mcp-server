# NEXUS MCP — Tools & Prompt Reference

> Trigger prompt to activate a tool by asking the corresponding natural-language question.

## Workspace

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 1 | `nexus_workspace_overview` | "project overview" / "what's in this repo?" |
| 2 | `nexus_search` | "search for `<pattern>`" / "grep for `<regex>`" |
| 3 | `nexus_read_span` | "read lines `<start>`-`<end>` of `<file>`" / "read span" |

## Code Intelligence

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 4 | `nexus_index_build` | "reindex the codebase" / "refresh the index" |
| 5 | `nexus_file_symbols` | "list symbols in `<file>`" / "what's defined in this file?" |
| 6 | `nexus_find_symbols` | "find function `<name>`" / "where is `<symbol>` defined?" |
| 7 | `nexus_references` | "where is `<symbol>` referenced?" |
| 8 | `nexus_call_graph` | "who calls `<function>`?" / "what does `<function>` call?" |
| 9 | `nexus_dependency_graph` | "what imports `<file>`?" / "who depends on `<file>`?" |

## Context

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 10 | `nexus_repo_map` | "show me the repo map" / "top files by importance" |
| 11 | `nexus_context_pack` | "build a context pack for `<file>`" / "I'm working on this, give me focused context" |

## Change Safety

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 12 | `nexus_impact_analysis` | "what would break if I change `<symbol>`?" / "blast radius of `<file>`" |
| 13 | `nexus_git_diff` | "show me git diff" / "what changed?" |
| 14 | `nexus_snapshot` | "checkpoint these files" / "snapshot before editing" |
| 15 | `nexus_restore` | "rollback to snapshot `<id>`" / "undo my changes" |

## Execution & Verification

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 16 | `nexus_exec` | "run `<command>`" / "execute `<cmd>` with timeout" |
| 17 | `nexus_exec_poll` | "poll background exec `<job-id>`" / "check exec status" |
| 18 | `nexus_test_run` | "run tests" / "run `<test-pattern>` tests" |
| 19 | `nexus_diagnose` | "run typecheck and lint" / "diagnose this code" |

## Memory

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 20 | `nexus_memory_write` | "remember `<fact>`" / "store this for later" |
| 21 | `nexus_memory_search` | "recall `<topic>`" / "what did we decide about `<X>`?" |
| 22 | `nexus_memory_forget` | "forget `<fact>`" / "delete this memory" |

## Orchestration

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 23 | `nexus_task_submit` | "create task DAG" / "orchestrate these steps" |
| 24 | `nexus_task_update` | "update task `<id>` to `<status>`" / "mark task done" |
| 25 | `nexus_task_status` | "task DAG status" / "show me pending tasks" |
| 26 | `nexus_fanout` | "run `<cmd>` across all `<items>`" / "parallel map over files" |

## Security

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 27 | `nexus_secret_scan` | "scan for secrets" / "secret scan this repo" |
| 28 | `nexus_audit_manifest` | "dependency inventory" / "check dependency risks" |

## Refactor

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 29 | `nexus_rename_symbol` | "rename `<symbol>` to `<new>`" / "workspace rename" |

## Meta

| # | Tool | Trigger Prompt |
|---|------|---------------|
| 30 | `nexus_server_status` | "server status" / "diagnostics" |
| 31 | `nexus_guide` | "how do I `<task>`?" / "nexus best practices for `<topic>`" |

---

## The Orchestrator Pattern

> "I'm working on this codebase — analyze it, find risks, propose a safe change, and verify it."

Activates: `nexus_repo_intelligence` (map) → `nexus_security_reliability` (threats) → `nexus_change_governance` (plan) → `nexus_ci_release` (verify) → `task` delegation → NEXUS write tools (with dry-run + rollback).

This is the end-to-end workflow this tool suite was designed for: **evidence-backed, safety-gated, audit-ready engineering**.
