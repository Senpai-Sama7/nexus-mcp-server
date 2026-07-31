/**
 * Per-language extraction patterns.
 *
 * Each language family defines three pattern sets:
 *  - symbols: declarations (functions, classes, methods, types, etc.)
 *  - imports:  dependency edges (import/require/use/include)
 *  - calls:    function-call sites (for call-graph edges)
 *
 * Symbol & call patterns operate on the STRIPPED source (comments +
 * string contents blanked by strip.ts) so false positives inside
 * comments/strings are eliminated. Import patterns run against RAW source,
 * however — specifiers are string literals that stripping would blank — so
 * extractImports receives raw text, not stripped text (see parser.ts).
 *
 * The patterns are intentionally permissive: a lexical parser trades
 * precision for coverage. False positives are mitigated by the graph
 * engine (unresolved symbols are simply not linked).
 */

import type { SymbolKind } from '../types.js';

export interface SymbolPattern {
  regex: RegExp;
  kind: SymbolKind;
  nameGroup: number;
  /** prefix that, if present before the match, marks the symbol as exported */
  exportedPrefix?: string;
  /** when true, the symbol is only valid when inside a class/struct body */
  requiresClassScope?: boolean;
}

export interface ImportPattern {
  regex: RegExp;
  specifierGroup: number;   // capture group for the module/path specifier
  namesGroup?: number;      // capture group for imported names (comma-sep)
  isTypeOnly: boolean;
  isDynamic: boolean;
}

export interface CallPattern {
  /** regex for call sites; group 1 = callee text */
  regex: RegExp;
  /** group carrying the callee text (default 1) */
  calleeGroup: number;
}

export interface LangPatterns {
  symbols: SymbolPattern[];
  imports: ImportPattern[];
  calls: CallPattern[];
}


// -------------------------------------------------- C-family (JS/TS/Java/C/C++/C#/Go/Rust/Swift/Kotlin/Scala/Dart)

const JS_TS_SYMBOLS: SymbolPattern[] = [
  { regex: /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g, kind: 'function', nameGroup: 1, exportedPrefix: 'export' },
  { regex: /^\s*(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g, kind: 'function', nameGroup: 1, exportedPrefix: 'export' },
  { regex: /^\s*(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/g, kind: 'function', nameGroup: 1, exportedPrefix: 'export' },
  { regex: /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class', nameGroup: 1, exportedPrefix: 'export' },
  { regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g, kind: 'interface', nameGroup: 1, exportedPrefix: 'export' },
  { regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<{]/g, kind: 'type', nameGroup: 1, exportedPrefix: 'export' },
  { regex: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g, kind: 'enum', nameGroup: 1, exportedPrefix: 'export' },
  { regex: /^\s+(?:static\s+|abstract\s+|public\s+|private\s+|protected\s+|readonly\s+|async\s+|get\s+|set\s+|override\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{=]+)?\s*[{=]/g, kind: 'method', nameGroup: 1, requiresClassScope: true },
];

const JS_TS_IMPORTS: ImportPattern[] = [
  { regex: /\bimport\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+)(?:\s*,\s*\{([^}]*)\})?|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g, specifierGroup: 5, isTypeOnly: false, isDynamic: false },
  { regex: /\bimport\s+['"]([^'"]+)['"]/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
  { regex: /\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\w+)\s+from\s+['"]([^'"]+)['"]/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
  { regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
  { regex: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, specifierGroup: 1, isTypeOnly: false, isDynamic: true },
  { regex: /\bimport\s+type\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g, specifierGroup: 1, isTypeOnly: true, isDynamic: false },
];

const JS_TS_CALLS: CallPattern[] = [
  { regex: /\b([A-Za-z_$][\w$]*)\s*\(/g, calleeGroup: 1 },
];

const GO_SYMBOLS: SymbolPattern[] = [
  { regex: /^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)\s*\(/g, kind: 'function', nameGroup: 1 },
  { regex: /^\s*type\s+([A-Za-z_][\w]*)\s+struct/g, kind: 'struct', nameGroup: 1 },
  { regex: /^\s*type\s+([A-Za-z_][\w]*)\s+interface/g, kind: 'interface', nameGroup: 1 },
  { regex: /^\s*type\s+([A-Za-z_][\w]*)\s*(?:=|\{)/g, kind: 'type', nameGroup: 1 },
];
const GO_IMPORTS: ImportPattern[] = [
  { regex: /\bimport\s+"([^"]+)"/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
  { regex: /\bimport\s+\w+\s+"([^"]+)"/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
];

const RUST_SYMBOLS: SymbolPattern[] = [
  { regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*(?:<[^>]*>)?\s*\(/g, kind: 'function', nameGroup: 1, exportedPrefix: 'pub' },
  { regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/g, kind: 'struct', nameGroup: 1, exportedPrefix: 'pub' },
  { regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/g, kind: 'enum', nameGroup: 1, exportedPrefix: 'pub' },
  { regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/g, kind: 'trait', nameGroup: 1, exportedPrefix: 'pub' },
  { regex: /^\s*impl(?:<[^>]*>)?\s+([A-Za-z_][\w]*)/g, kind: 'impl', nameGroup: 1 },
  { regex: /^\s*(?:pub\s+)?(?:const|static)\s+([A-Za-z_][\w]*)/g, kind: 'constant', nameGroup: 1, exportedPrefix: 'pub' },
];
const RUST_IMPORTS: ImportPattern[] = [
  { regex: /\buse\s+([\w:]+)(?:\s+as\s+\w+)?\s*;/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
  { regex: /\buse\s+([\w:]+)::\{([^}]*)\}/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
];

const PY_SYMBOLS: SymbolPattern[] = [
  { regex: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/g, kind: 'function', nameGroup: 1 },
  { regex: /^\s*class\s+([A-Za-z_][\w]*)\s*[(:]/g, kind: 'class', nameGroup: 1 },
];
const PY_IMPORTS: ImportPattern[] = [
  { regex: /^\s*from\s+([\w.]+)\s+import\s+(.+)/g, specifierGroup: 1, namesGroup: 2, isTypeOnly: false, isDynamic: false },
  { regex: /^\s*import\s+([\w.]+)/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
];

const RUBY_SYMBOLS: SymbolPattern[] = [
  { regex: /^\s*def\s+(?:self\.)?([A-Za-z_][\w]*)\s*[?(]/g, kind: 'function', nameGroup: 1 },
  { regex: /^\s*class\s+([A-Za-z_][\w]*)/g, kind: 'class', nameGroup: 1 },
  { regex: /^\s*module\s+([A-Za-z_][\w]*)/g, kind: 'module', nameGroup: 1 },
];
const RUBY_IMPORTS: ImportPattern[] = [
  { regex: /\brequire(?:_relative)?\s+['"]([^'"]+)['"]/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
];

const C_SYMBOLS: SymbolPattern[] = [
  { regex: /^\s*(?:\w[\w\s\*:<>&]*\s)+([A-Za-z_][\w]*)\s*\([^)]*\)\s*(?:const)?\s*\{/g, kind: 'function', nameGroup: 1 },
  { regex: /^\s*(?:class|struct)\s+([A-Za-z_][\w]*)/g, kind: 'class', nameGroup: 1 },
  { regex: /^\s*interface\s+([A-Za-z_][\w]*)/g, kind: 'interface', nameGroup: 1 },
  { regex: /^\s*enum\s+(?:class\s+)?([A-Za-z_][\w]*)/g, kind: 'enum', nameGroup: 1 },
  { regex: /^\s*(?:typedef|using)\s+([A-Za-z_][\w]*)/g, kind: 'type', nameGroup: 1 },
];
const C_IMPORTS: ImportPattern[] = [
  { regex: /\b#include\s*[<"]([^>"]+)[>"]/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
  { regex: /\busing\s+([\w.:]+);/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
  { regex: /\bimport\s+([\w.]+);/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
];

const SHELL_SYMBOLS: SymbolPattern[] = [
  { regex: /^\s*(?:function\s+)?([A-Za-z_][\w]*)\s*\(\s*\)\s*\{/g, kind: 'function', nameGroup: 1 },
];
const SHELL_IMPORTS: ImportPattern[] = [
  { regex: /^\s*(?:source|\.)\s+(.+)/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
];

const GENERIC_CALLS: CallPattern[] = [
  { regex: /\b([A-Za-z_$][\w$]*)\s*\(/g, calleeGroup: 1 },
];

export function getPatterns(language: string): LangPatterns | null {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return { symbols: JS_TS_SYMBOLS, imports: JS_TS_IMPORTS, calls: JS_TS_CALLS };
    case 'go':
      return { symbols: GO_SYMBOLS, imports: GO_IMPORTS, calls: GENERIC_CALLS };
    case 'rust':
      return { symbols: RUST_SYMBOLS, imports: RUST_IMPORTS, calls: GENERIC_CALLS };
    case 'python':
      return { symbols: PY_SYMBOLS, imports: PY_IMPORTS, calls: GENERIC_CALLS };
    case 'ruby':
      return { symbols: RUBY_SYMBOLS, imports: RUBY_IMPORTS, calls: GENERIC_CALLS };
    case 'c':
    case 'cpp':
    case 'csharp':
    case 'java':
    case 'kotlin':
    case 'swift':
    case 'scala':
    case 'dart':
    case 'php':
      return { symbols: C_SYMBOLS, imports: C_IMPORTS, calls: GENERIC_CALLS };
    case 'shell':
    case 'perl':
      return { symbols: SHELL_SYMBOLS, imports: SHELL_IMPORTS, calls: GENERIC_CALLS };
    case 'lua':
      return {
        symbols: [
          { regex: /^\s*(?:local\s+)?function\s+([A-Za-z_][\w]*)\s*\(/g, kind: 'function', nameGroup: 1 },
        ],
        imports: [
          { regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, specifierGroup: 1, isTypeOnly: false, isDynamic: false },
        ],
        calls: GENERIC_CALLS,
      };
    default:
      return null;
  }
}


