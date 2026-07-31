import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { pageRank, buildFileGraph, createDiGraph, addEdge } from '../../src/lib/graph.js';
import { estimateTokens } from '../../src/types.js';
import type { CodeIndexSnapshot } from '../../src/types.js';

/**
 * Performance benchmarks for NEXUS engines.
 * Tests validate that core operations meet performance targets.
 */

describe('Performance Benchmarks', () => {
  it('PageRank on 1000-node graph < 500ms', () => {
    const g = createDiGraph();
    // Create chain graph: 0→1→2→...→999
    for (let i = 0; i < 1000; i++) {
      addEdge(g, `n${i}`, `n${(i + 1) % 1000}`);
    }
    
    const start = performance.now();
    const scores = pageRank(g, { iterations: 30 });
    const elapsed = performance.now() - start;
    
    expect(scores.size).toBe(1000);
    expect(elapsed).toBeLessThan(500);
    console.log(`✓ PageRank on 1000 nodes: ${elapsed.toFixed(2)}ms`);
  });

  it('PageRank on 10000-node graph < 5s', () => {
    const g = createDiGraph();
    for (let i = 0; i < 10000; i++) {
      addEdge(g, `n${i}`, `n${(i + 1) % 10000}`);
    }
    
    const start = performance.now();
    const scores = pageRank(g, { iterations: 20 });  // Fewer iterations for large graph
    const elapsed = performance.now() - start;
    
    expect(scores.size).toBe(10000);
    expect(elapsed).toBeLessThan(5000);
    console.log(`✓ PageRank on 10000 nodes: ${elapsed.toFixed(2)}ms`);
  });

  it('Token estimation on 1MB text < 10ms', () => {
    const text = 'const x = 1;'.repeat(85000);  // ~1 MB
    
    const start = performance.now();
    const tokens = estimateTokens(text);
    const elapsed = performance.now() - start;
    
    expect(tokens).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10);
    console.log(`✓ Token estimation on 1MB: ${elapsed.toFixed(2)}ms, ~${tokens} tokens`);
  });

  it('Token estimation on 10MB text < 100ms', () => {
    const text = 'const x = 1;'.repeat(850000);  // ~10 MB
    
    const start = performance.now();
    const tokens = estimateTokens(text);
    const elapsed = performance.now() - start;
    
    expect(tokens).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
    console.log(`✓ Token estimation on 10MB: ${elapsed.toFixed(2)}ms, ~${tokens} tokens`);
  });

  it('File graph construction from snapshot < 100ms', () => {
    // Simulate a medium-sized index snapshot
    const snapshot: CodeIndexSnapshot = {
      version: 1,
      builtAt: new Date().toISOString(),
      root: '/test',
      files: {},
      stats: { fileCount: 0, indexedCount: 0, skippedCount: 0, symbolCount: 0, edgeCount: 0, durationMs: 0 }
    };
    
    // Create 1000 files with imports
    for (let i = 0; i < 1000; i++) {
      snapshot.files[`file${i}.ts`] = {
        file: `file${i}.ts`,
        language: 'typescript',
        sizeBytes: 1000,
        mtimeMs: Date.now(),
        headHash: 'abc123',
        symbols: [],
        imports: [
          { from: `file${i}.ts`, specifier: `./file${(i - 1 + 1000) % 1000}.ts`, to: `file${(i - 1 + 1000) % 1000}.ts`, names: [], isTypeOnly: false, isDynamic: false, line: 1 }
        ],
        calls: [],
        parseBackend: 'lexical',
        parseErrors: 0,
        skipped: false
      };
    }
    
    const start = performance.now();
    const graph = buildFileGraph(snapshot);
    const elapsed = performance.now() - start;
    
    expect(graph.nodes.size).toBe(1000);
    expect(elapsed).toBeLessThan(100);
    console.log(`✓ File graph construction (1000 files): ${elapsed.toFixed(2)}ms`);
  });

  it('Reachability query on 1000-node graph < 50ms', () => {
    const g = createDiGraph();
    for (let i = 0; i < 1000; i++) {
      addEdge(g, `n${i}`, `n${(i + 1) % 1000}`);
    }
    
    const start = performance.now();
    let visited = 0;
    for (let i = 0; i < 100; i++) {
      // Query reachability from random nodes
      const reach = new Set<string>();
      const queue = [`n${i}`];
      while (queue.length > 0) {
        const node = queue.pop()!;
        if (reach.has(node)) continue;
        reach.add(node);
        for (const succ of g.out.get(node) ?? new Set()) {
          if (!reach.has(succ)) queue.push(succ);
        }
      }
      visited += reach.size;
    }
    const elapsed = performance.now() - start;
    
    expect(visited).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
    console.log(`✓ 100 reachability queries on 1000-node graph: ${elapsed.toFixed(2)}ms`);
  });

  it('Memory usage under 500MB for large graph', () => {
    const before = process.memoryUsage().heapUsed;
    
    const g = createDiGraph();
    for (let i = 0; i < 50000; i++) {
      addEdge(g, `n${i}`, `n${(i + 1) % 50000}`);
    }
    
    const after = process.memoryUsage().heapUsed;
    const heapDelta = (after - before) / 1024 / 1024;
    
    expect(heapDelta).toBeLessThan(500);
    console.log(`✓ 50k-node graph memory delta: ${heapDelta.toFixed(1)} MB`);
  });

  it('Batch token estimation (100 files) < 200ms', () => {
    const fileContents: string[] = [];
    for (let i = 0; i < 100; i++) {
      fileContents.push(`
        // File ${i}
        function file${i}Func() {
          // Implementation
          const x = ${i};
          return x * 2;
        }
      `.repeat(10));
    }
    
    const start = performance.now();
    let totalTokens = 0;
    for (const content of fileContents) {
      totalTokens += estimateTokens(content);
    }
    const elapsed = performance.now() - start;
    
    expect(totalTokens).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
    console.log(`✓ 100 files token estimation: ${elapsed.toFixed(2)}ms, ~${totalTokens} total tokens`);
  });

  it('String search simulation on 1MB text < 100ms', () => {
    const text = ('const x = 1; function foo() { return x + 1; } // line\n'.repeat(16000)).repeat(1);  // ~1 MB
    const pattern = 'function';
    
    const start = performance.now();
    let matches = 0;
    let index = 0;
    while ((index = text.indexOf(pattern, index)) !== -1) {
      matches++;
      index += pattern.length;
    }
    const elapsed = performance.now() - start;
    
    expect(matches).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
    console.log(`✓ String search on 1MB text: ${elapsed.toFixed(2)}ms, ${matches} matches`);
  });

  it('JSON parse/stringify on large snapshot < 500ms', () => {
    // Create a large snapshot
    const snapshot: CodeIndexSnapshot = {
      version: 1,
      builtAt: new Date().toISOString(),
      root: '/test',
      files: {},
      stats: { fileCount: 5000, indexedCount: 5000, skippedCount: 0, symbolCount: 50000, edgeCount: 100000, durationMs: 30000 }
    };
    
    for (let i = 0; i < 5000; i++) {
      snapshot.files[`file${i}.ts`] = {
        file: `file${i}.ts`,
        language: 'typescript',
        sizeBytes: 5000,
        mtimeMs: Date.now(),
        headHash: 'abc123def456',
        symbols: Array.from({ length: 10 }, (_, j) => ({
          id: `file${i}::sym${j}`,
          name: `symbol${j}`,
          qualname: `Class.method${j}`,
          kind: 'method' as const,
          file: `file${i}.ts`,
          startLine: j * 10,
          endLine: (j + 1) * 10,
          exported: j % 2 === 0,
        })),
        imports: Array.from({ length: 5 }, (_, j) => ({
          from: `file${i}.ts`,
          specifier: `./file${(i + j) % 5000}.ts`,
          to: `file${(i + j) % 5000}.ts`,
          names: ['foo', 'bar'],
          isTypeOnly: false,
          isDynamic: false,
          line: j + 1
        })),
        calls: [],
        parseBackend: 'lexical',
        parseErrors: 0,
        skipped: false
      };
    }
    
    const start = performance.now();
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json);
    const elapsed = performance.now() - start;
    
    expect(parsed.files).toBeDefined();
    expect(elapsed).toBeLessThan(500);
    console.log(`✓ Serialize/deserialize 5000-file snapshot: ${elapsed.toFixed(2)}ms, ${(json.length / 1024 / 1024).toFixed(2)} MB`);
  });
});
