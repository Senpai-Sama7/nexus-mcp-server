/**
 * Comment & string stripper — replaces comment and string CONTENTS with
 * spaces (preserving newlines for line-number accuracy) so that declaration,
 * import, and call regexes never match inside comments or string literals.
 *
 * The string DELIMITERS are kept (so structure is visible), but everything
 * between them is blanked. Comment delimiters are also blanked.
 *
 * State machine: normal → lineComment → blockComment → string → normal.
 * Handles escape sequences (\\X), multi-line block comments, multi-line
 * template literals, and Python triple-quoted strings.
 */

import type { LanguageSpec } from './langdetect.js';

export function stripCommentsAndStrings(text: string, spec: LanguageSpec): string {
  // Fast path: no delimiters at all → nothing to strip
  if (!spec.lineComment && !spec.blockComment && !spec.blockComments && !spec.stringDelims?.length && !spec.templateDelims?.length) {
    return text;
  }

  const chars = Array.from(text);
  const n = chars.length;

  // Gather all block-comment pairs
  const blockPairs: Array<[string, string]> = [];
  if (spec.blockComment) blockPairs.push(spec.blockComment);
  if (spec.blockComments) blockPairs.push(...spec.blockComments);

  // Gather all string (and template) delimiters
  const stringPairs: Array<[string, string, boolean]> = []; // [open, close, multiline]
  for (const [o, c] of spec.stringDelims ?? []) stringPairs.push([o, c, false]);
  for (const [o, c] of spec.templateDelims ?? []) stringPairs.push([o, c, true]);

  let i = 0;
  let state: 'normal' | 'line' | 'block' | 'string' = 'normal';
  let closeDelim = '';
  let isMultiline = false;

  while (i < n) {
    const ch = chars[i]!;

    if (state === 'normal') {
      // Try line comment
      let matched = false;
      if (spec.lineComment) {
        for (const lc of spec.lineComment) {
          if (lc.length === 1 ? ch === lc : text.startsWith(lc, i)) {
            state = 'line';
            for (let j = 0; j < lc.length && i + j < n; j++) chars[i + j] = ' ';
            i += lc.length;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;

      // Try block comment
      for (const [open, close] of blockPairs) {
        if (text.startsWith(open, i)) {
          state = 'block';
          closeDelim = close;
          for (let j = 0; j < open.length && i + j < n; j++) chars[i + j] = ' ';
          i += open.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Try strings
      for (const [open, close, multiline] of stringPairs) {
        if (text.startsWith(open, i)) {
          state = 'string';
          closeDelim = close;
          isMultiline = multiline;
          i += open.length; // keep opening delimiter for structure
          matched = true;
          break;
        }
      }
      if (matched) continue;

      i++;
    } else if (state === 'line') {
      if (ch === '\n') {
        state = 'normal';
      } else {
        chars[i] = ' ';
      }
      i++;
    } else if (state === 'block') {
      if (text.startsWith(closeDelim, i)) {
        for (let j = 0; j < closeDelim.length && i + j < n; j++) chars[i + j] = ' ';
        i += closeDelim.length;
        state = 'normal';
        closeDelim = '';
      } else {
        if (ch !== '\n') chars[i] = ' ';
        i++;
      }
    } else {
      // string state
      if (ch === '\\') {
        // Escape: blank backslash + escaped char (preserve newline)
        chars[i] = ' ';
        if (i + 1 < n && chars[i + 1] !== '\n') chars[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (text.startsWith(closeDelim, i)) {
        i += closeDelim.length; // keep closing delimiter
        state = 'normal';
        closeDelim = '';
        isMultiline = false;
        continue;
      }
      if (ch === '\n' && !isMultiline) {
        // Unescaped newline in single-line string → end string
        state = 'normal';
        closeDelim = '';
      } else if (ch !== '\n') {
        chars[i] = ' ';
      }
      i++;
    }
  }

  return chars.join('');
}
