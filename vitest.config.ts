import { defineConfig } from 'vitest/config';

/**
 * NEXUS source uses the NodeNext ESM idiom (see src/lib/index.ts line 109): TS
 * imports are written as `./foo.js` to mean `./foo.ts`. `tsc` (module: NodeNext)
 * resolves this, but vite/vitest do not rewrite `.js` -> `.ts`, so benchmarks
 * and unit tests that import src modules fail to resolve. This plugin rewrites
 * relative `.js/.jsx/.mjs/.cjs` specifiers to `.ts/.tsx/.mts/.cts` in loaded
 * source (only project files, never node_modules) — dependency-free.
 */
const nexusTsExtensions = {
  name: 'nexus:ts-extensions',
  enforce: 'pre' as const,
  transform(code: string, id: string | undefined) {
    if (!id || id.includes('node_modules')) return null;
    const map: Record<string, string> = { js: 'ts', jsx: 'tsx', mjs: 'mts', cjs: 'cts' };
    const re = /(['"])(\.\.?\/[^\s'"]+?)\.(js|jsx|mjs|cjs)\1/g;
    let out: string | null = null;
    // Rewrite only when a match exists.
    if (re.test(code)) {
      re.lastIndex = 0;
      out = code.replace(re, (_, q: string, path: string, ext: string) => `${q}${path}.${map[ext]}${q}`);
    }
    return out === null ? null : { code: out, map: null };
  },
};

export default defineConfig({
  plugins: [nexusTsExtensions],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'bench/**/*.bench.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
