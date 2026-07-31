/** Shared tool utilities — result formatting, error handling, pagination. */

import { z } from 'zod';
import type { Session } from '../session.js';
import { asNexusError } from '../lib/errors.js';

/** Matches the SDK's CallToolResult shape. */
export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
};

export function makeToolResult(text: string, structured?: Record<string, unknown>, isError = false): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text }] };
  if (structured) result.structuredContent = structured;
  if (isError) result.isError = true;
  return result;
}

export function makeErrorResult(err: unknown): ToolResult {
  const ne = asNexusError(err);
  const text = `ERROR [${ne.code}]: ${ne.message}${ne.hint ? '\nHint: ' + ne.hint : ''}`;
  return makeToolResult(text, ne.toJSON(), true);
}

export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return makeToolResult(text, structured, false);
}

export function err(msg: string, code: string, hint?: string): ToolResult {
  return makeToolResult(`ERROR [${code}]: ${msg}${hint ? '\nHint: ' + hint : ''}`, { code, message: msg, hint }, true);
}
