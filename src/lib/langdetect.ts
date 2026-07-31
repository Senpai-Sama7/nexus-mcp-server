/**
 * Language detection — maps file extensions to canonical language names
 * and provides per-language comment/string delimiter metadata used by the
 * comment stripper (strip.ts) before regex extraction runs.
 *
 * Coverage: 20+ languages. The parser gracefully no-ops on unknown
 * extensions (file still appears in the index as a data file).
 */

export interface LanguageSpec {
  language: string;
  lineComment?: string[];       // e.g. ['//']
  blockComment?: [string, string]; // e.g. ['/*', '*/']
  blockComments?: Array<[string, string]>; // additional block-comment pairs (Python ''', etc.)
  stringDelims?: [string, string][]; // e.g. [['"', '"'], ["'", "'"]]
  /** template-string delimiters (JS/TS backticks) — these can span lines */
  templateDelims?: [string, string][];
}

const EXT_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', lua: 'lua',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  scala: 'scala', sc: 'scala', dart: 'dart', r: 'r', pl: 'perl', pm: 'perl',
  vim: 'vim', el: 'emacs', clj: 'clojure', cljs: 'clojure', ex: 'elixir',
  exs: 'elixir', erl: 'erlang', fs: 'fsharp', fsx: 'fsharp',
  vue: 'vue', svelte: 'svelte', html: 'html', htm: 'html', xml: 'xml',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml', md: 'markdown',
};

export function detectLanguage(relPath: string): string | null {
  const ext = relPath.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return EXT_MAP[ext] ?? null;
}

const C_LINE = ['//'];
const C_BLOCK: [string, string] = ['/*', '*/'];
const C_STRINGS: [string, string][] = [['"', '"'], ["'", "'"]];
const C_TEMPLATE: [string, string][] = [['`', '`']];

const HASH_LINE = ['#'];
const TRIPLE_BLOCK: [string, string] = ['"""', '"""'];
const PY_STRINGS: [string, string][] = [['"', '"'], ["'", "'"]];

const LUA_LINE = ['--'];
const LUA_BLOCK: [string, string] = ['--[[', ']]'];

const SHELL_LINE = ['#'];

const LISP_LINE = [';'];

const SPECS: Record<string, LanguageSpec> = {
  typescript: { language: 'typescript', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS, templateDelims: C_TEMPLATE },
  javascript: { language: 'javascript', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS, templateDelims: C_TEMPLATE },
  c: { language: 'c', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  cpp: { language: 'cpp', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  csharp: { language: 'csharp', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  java: { language: 'java', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  kotlin: { language: 'kotlin', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  go: { language: 'go', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  rust: { language: 'rust', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  swift: { language: 'swift', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  scala: { language: 'scala', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  dart: { language: 'dart', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  php: { language: 'php', lineComment: C_LINE.concat(['#']), blockComment: C_BLOCK, stringDelims: C_STRINGS },
  python: { language: 'python', lineComment: HASH_LINE, blockComment: TRIPLE_BLOCK, blockComments: [["'''", "'''"]], stringDelims: PY_STRINGS },
  ruby: { language: 'ruby', lineComment: HASH_LINE, stringDelims: PY_STRINGS },
  lua: { language: 'lua', lineComment: LUA_LINE, blockComment: LUA_BLOCK, stringDelims: PY_STRINGS },
  shell: { language: 'shell', lineComment: SHELL_LINE, stringDelims: PY_STRINGS },
  perl: { language: 'perl', lineComment: HASH_LINE, stringDelims: PY_STRINGS },
  r: { language: 'r', lineComment: HASH_LINE, stringDelims: PY_STRINGS },
  vim: { language: 'vim', lineComment: ['"'], stringDelims: PY_STRINGS },
  clojure: { language: 'clojure', lineComment: LISP_LINE, stringDelims: PY_STRINGS },
  elixir: { language: 'elixir', lineComment: HASH_LINE, stringDelims: PY_STRINGS },
  erlang: { language: 'erlang', lineComment: ['%'], stringDelims: PY_STRINGS },
  fsharp: { language: 'fsharp', lineComment: LISP_LINE, blockComment: ['(*', '*)'], stringDelims: PY_STRINGS },
  // data/config formats — no symbol extraction, but tracked for dependency graph
  json: { language: 'json', stringDelims: C_STRINGS },
  yaml: { language: 'yaml', lineComment: HASH_LINE },
  toml: { language: 'toml', lineComment: HASH_LINE },
  markdown: { language: 'markdown' },
  html: { language: 'html', blockComment: ['<!--', '-->'] },
  css: { language: 'css', blockComment: C_BLOCK },
  scss: { language: 'scss', lineComment: C_LINE, blockComment: C_BLOCK },
  sass: { language: 'sass', lineComment: C_LINE },
  less: { language: 'less', lineComment: C_LINE, blockComment: C_BLOCK },
  vue: { language: 'vue', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
  svelte: { language: 'svelte', lineComment: C_LINE, blockComment: C_BLOCK, stringDelims: C_STRINGS },
};

export function getSpec(language: string): LanguageSpec | null {
  return SPECS[language] ?? null;
}

/** Languages for which we have symbol extraction patterns. */
export const EXTRACTABLE_LANGS = new Set([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin',
  'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'scala', 'dart',
  'lua', 'shell', 'perl', 'r',
]);

export function isExtractable(language: string | null): boolean {
  return language !== null && EXTRACTABLE_LANGS.has(language);
}
