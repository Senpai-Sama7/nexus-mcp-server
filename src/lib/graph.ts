/**
 * Graph engine — adjacency, PageRank, Tarjan SCC, reachability.
 * File dependency edges: file A imports file B → A→B
 * Symbol call edges: function A calls function B → A→B
 */

import type { CodeIndexSnapshot } from '../types.js';

export interface GraphNode { id: string; label: string; kind: 0 | 1; }

export interface DiGraph {
  nodes: Map<string, GraphNode>;
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
}

export function createDiGraph(): DiGraph {
  return { nodes: new Map(), out: new Map(), in: new Map() };
}

export function addNode(g: DiGraph, id: string, label: string, kind: 0 | 1): void {
  if (!g.nodes.has(id)) {
    g.nodes.set(id, { id, label, kind });
    g.out.set(id, new Set());
    g.in.set(id, new Set());
  }
}

export function addEdge(g: DiGraph, from: string, to: string): void {
  addNode(g, from, '', 0);
  addNode(g, to, '', 0);
  g.out.get(from)!.add(to);
  g.in.get(to)!.add(from);
}

export function pageRank(g: DiGraph, opts: { damping?: number; iterations?: number; tolerance?: number } = {}): Map<string, number> {
  const damping = opts.damping ?? 0.85;
  const iterations = opts.iterations ?? 40;
  const tolerance = opts.tolerance ?? 1e-6;
  const n = g.nodes.size;
  if (n === 0) return new Map();
  const ids = [...g.nodes.keys()];
  let scores = new Map<string, number>();
  for (const id of ids) scores.set(id, 1 / n);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    let danglingSum = 0;
    for (const id of ids) { if (g.out.get(id)!.size === 0) danglingSum += scores.get(id) ?? 0; }
    for (const id of ids) {
      let rank = (1 - damping) / n;
      for (const pred of g.in.get(id)!) {
        const predOut = g.out.get(pred)!.size;
        if (predOut > 0) rank += damping * ((scores.get(pred) ?? 0) / predOut);
      }
      rank += damping * (danglingSum / n);
      next.set(id, rank);
    }
    let maxDelta = 0;
    for (const id of ids) maxDelta = Math.max(maxDelta, Math.abs((next.get(id) ?? 0) - (scores.get(id) ?? 0)));
    scores = next;
    if (maxDelta < tolerance) break;
  }
  return scores;
}

export function tarjanSCC(g: DiGraph): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: string[][] = [];
  function strong(v: string): void {
    indices.set(v, index); lowlinks.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of g.out.get(v)!) {
      if (!indices.has(w)) { strong(w); lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!)); }
      else if (onStack.has(w)) { lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!)); }
    }
    if (lowlinks.get(v) === indices.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
      sccs.push(comp);
    }
  }
  for (const id of g.nodes.keys()) if (!indices.has(id)) strong(id);
  return sccs;
}

export function reachableForward(g: DiGraph, start: string): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const succ of g.out.get(node) ?? new Set()) if (!visited.has(succ)) queue.push(succ);
  }
  visited.delete(start);
  return visited;
}

export function reachableBackward(g: DiGraph, target: string): Set<string> {
  const visited = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const node = queue.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const pred of g.in.get(node) ?? new Set()) if (!visited.has(pred)) queue.push(pred);
  }
  visited.delete(target);
  return visited;
}

export function topoSort(g: DiGraph): string[][] {
  const sccs = tarjanSCC(g);
  const sccOf = new Map<string, number>();
  sccs.forEach((comp, i) => comp.forEach(n => sccOf.set(n, i)));
  const sccGraph = new Map<number, Set<number>>();
  for (let i = 0; i < sccs.length; i++) sccGraph.set(i, new Set());
  for (const [from, outs] of g.out) {
    const fromScc = sccOf.get(from)!;
    for (const to of outs) { const toScc = sccOf.get(to)!; if (fromScc !== toScc) sccGraph.get(fromScc)!.add(toScc); }
  }
  const inDeg = new Map<number, number>();
  for (let i = 0; i < sccs.length; i++) inDeg.set(i, 0);
  for (const [, outs] of sccGraph) for (const to of outs) inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
  const queue: number[] = [];
  for (let i = 0; i < sccs.length; i++) if ((inDeg.get(i) ?? 0) === 0) queue.push(i);
  const order: string[][] = [];
  while (queue.length > 0) {
    const sccIdx = queue.shift()!;
    order.push(sccs[sccIdx]!);
    for (const succ of sccGraph.get(sccIdx) ?? new Set()) { inDeg.set(succ, (inDeg.get(succ) ?? 0) - 1); if ((inDeg.get(succ) ?? 0) === 0) queue.push(succ); }
  }
  return order;
}

export function buildFileGraph(snapshot: CodeIndexSnapshot): DiGraph {
  const g = createDiGraph();
  for (const relPath of Object.keys(snapshot.files)) addNode(g, relPath, relPath, 0);
  for (const [relPath, fi] of Object.entries(snapshot.files)) for (const imp of fi.imports) if (imp.to) addEdge(g, relPath, imp.to);
  return g;
}

export function buildCallGraph(snapshot: CodeIndexSnapshot): DiGraph {
  const g = createDiGraph();
  for (const [, fi] of Object.entries(snapshot.files)) for (const sym of fi.symbols) if (sym.kind === 'function' || sym.kind === 'method') addNode(g, sym.id, sym.qualname, 1);
  for (const [, fi] of Object.entries(snapshot.files)) for (const call of fi.calls) if (call.callerId && call.calleeId) addEdge(g, call.callerId, call.calleeId);
  return g;
}
