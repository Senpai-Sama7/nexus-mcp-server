/** Code intelligence tools: index_build, file_symbols, find_symbols, references, call_graph, dependency_graph */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';
import { buildFileGraph, buildCallGraph, pageRank, reachableBackward, reachableForward } from '../lib/graph.js';
import { paginate } from '../types.js';

export function registerCodeIntelTools(server: McpServer, session: Session): void {
  // 4. index_build
  server.registerTool('nexus_index_build', {
    description: 'Build or refresh the code index (symbols, imports, calls). Required before code-intel tools.',
    inputSchema: { force: z.boolean().default(false).describe('Force full rebuild (ignore incremental cache)') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const r = await session.index.build(args.force as boolean);
    const text = `Index built: ${r.filesIndexed} files, ${r.symbols} symbols, ${r.edges} edges in ${r.durationMs}ms (${r.filesSkipped} skipped).`;
    return ok(text, { ...r });
  });

  // 5. file_symbols
  server.registerTool('nexus_file_symbols', {
    description: 'Get the symbol outline of a file (functions, classes, types, etc.).',
    inputSchema: { file: z.string().describe('Workspace-relative path') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built. Call nexus_index_build first.', 'DIRTY_INDEX');
    const fi = snap.files[args.file as string];
    if (!fi) return err(`File not in index: ${args.file}`, 'PATH_NOT_FOUND');
    const symbols = fi.symbols.map(s => `${s.startLine}: ${s.exported ? '✓' : ' '} ${s.kind.padEnd(10)} ${s.qualname}`).join('\n');
    const text = `${args.file} (${fi.language}, ${fi.symbols.length} symbols, ${fi.parseErrors} parse errors)\n${symbols || '(no symbols)'}`;
    return ok(text, { file: args.file, language: fi.language, symbols: fi.symbols, parseErrors: fi.parseErrors });
  });

  // 6. find_symbols
  server.registerTool('nexus_find_symbols', {
    description: 'Fuzzy search for symbols across the entire workspace.',
    inputSchema: { name: z.string().describe('Symbol name (partial match)'), kind: z.string().optional().describe('Filter by kind (function, class, etc.)'), limit: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built.', 'DIRTY_INDEX');
    const q = (args.name as string).toLowerCase();
    const kind = args.kind as string | undefined;
    const results: { id: string; name: string; qualname: string; kind: string; file: string; line: number; exported: boolean }[] = [];
    for (const [, fi] of Object.entries(snap.files)) {
      for (const s of fi.symbols) {
        if (kind && s.kind !== kind) continue;
        if (s.name.toLowerCase().includes(q)) { results.push({ id: s.id, name: s.name, qualname: s.qualname, kind: s.kind, file: s.file, line: s.startLine, exported: s.exported }); }
      }
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    const limited = results.slice(0, args.limit as number);
    const text = limited.length > 0 ? limited.map(s => `${s.kind.padEnd(10)} ${s.qualname}  ${s.file}:${s.line}${s.exported ? ' [exported]' : ''}`).join('\n') : 'No symbols found.';
    return ok(text, { results: limited, total: results.length, truncated: results.length > limited.length });
  });

  // 7. references
  server.registerTool('nexus_references', {
    description: 'Find all reference sites of a symbol (calls, imports, type annotations).',
    inputSchema: { symbol: z.string().describe('Symbol name or qualname') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built.', 'DIRTY_INDEX');
    const q = (args.symbol as string).toLowerCase();
    const refs: { file: string; line: number; caller: string; calleeText: string; kind: string }[] = [];
    for (const [, fi] of Object.entries(snap.files)) {
      for (const call of fi.calls) { if (call.calleeText.toLowerCase().includes(q)) refs.push({ file: call.file, line: call.line, caller: call.callerName, calleeText: call.calleeText, kind: call.dynamic ? 'dynamic' : 'resolved' }); }
      for (const imp of fi.imports) { if (imp.names.some(n => n.toLowerCase().includes(q))) refs.push({ file: imp.from, line: imp.line, caller: '<import>', calleeText: imp.specifier, kind: 'import' }); }
    }
    const text = refs.length > 0 ? refs.map(r => `${r.file}:${r.line} ${r.kind} ${r.calleeText} (in ${r.caller})`).join('\n') : 'No references found.';
    return ok(text, { references: refs.slice(0, 50), total: refs.length, truncated: refs.length > 50 });
  });

  // 8. call_graph
  server.registerTool('nexus_call_graph', {
    description: 'Callers or callees of a function, depth-N.',
    inputSchema: { symbol: z.string().describe('Function name or qualname'), direction: z.enum(['callers', 'callees']).default('callees'), depth: z.number().int().min(1).max(5).default(2) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built.', 'DIRTY_INDEX');
    const g = buildCallGraph(snap);
    const q = (args.symbol as string).toLowerCase();
    const startNodes = [...g.nodes.keys()].filter(n => n.toLowerCase().includes(q));
    if (startNodes.length === 0) return err(`No matching symbol found for: ${args.symbol}`, 'SYMBOL_NOT_FOUND', 'Call nexus_index_build first, or check the symbol name.');
    const start = startNodes[0]!;
    const dir = args.direction as 'callers' | 'callees';
    const reachable = dir === 'callers' ? reachableBackward(g, start) : reachableForward(g, start);
    const text = `${dir === 'callers' ? 'Callers' : 'Callees'} of ${start} (${reachable.size} found):\n${[...reachable].sort().map(n => '  ' + n).join('\n')}`;
    return ok(text, { symbol: start, direction: dir, count: reachable.size, nodes: [...reachable] });
  });

  // 9. dependency_graph
  server.registerTool('nexus_dependency_graph', {
    description: 'Import dependencies of a file (what it depends on) or dependents (what depends on it).',
    inputSchema: { file: z.string().describe('Workspace-relative path'), direction: z.enum(['deps', 'dependents']).default('deps') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built.', 'DIRTY_INDEX');
    const g = buildFileGraph(snap);
    const file = args.file as string;
    if (!g.nodes.has(file)) return err(`File not in graph: ${file}`, 'PATH_NOT_FOUND');
    const dir = args.direction as 'deps' | 'dependents';
    const neighbors = dir === 'deps' ? (g.out.get(file) ?? new Set()) : (g.in.get(file) ?? new Set());
    const external = (snap.files[file]?.imports ?? []).filter(i => !i.to).map(i => i.specifier);
    const text = `${dir === 'deps' ? 'Dependencies' : 'Dependents'} of ${file}:\n${[...neighbors].sort().map(n => '  ' + n).join('\n') || '  (none)'}${external.length > 0 && dir === 'deps' ? '\nExternal packages:\n' + external.map(e => '  ' + e).join('\n') : ''}`;
    return ok(text, { file, direction: dir, internal: [...neighbors].sort(), external: dir === 'deps' ? external : [] });
  });
}
