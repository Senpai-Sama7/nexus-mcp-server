/**
 * NEXUS logger — JSON-lines on STDERR only.
 *
 * CRITICAL MCP RULE: stdio transport speaks JSON-RPC on stdout. A single
 * stray console.log to stdout corrupts the protocol stream and the client
 * will drop the server. Everything diagnostic goes to stderr.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

let current: LogLevel = (process.env.NEXUS_LOG_LEVEL as LogLevel) || 'info';
if (!(current in ORDER)) current = 'info';

export function setLogLevel(level: LogLevel): void {
  current = level;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[current]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  });
  process.stderr.write(line + '\n');
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

/** Redact a value for logging (truncate long strings). */
export function trunc(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[+${s.length - max} chars]`;
}
