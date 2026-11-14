/**
 * Minimal leveled logger used by the hooks.
 *
 * Quiet by default ('warn'): only warnings and errors reach the console.
 * Pass `logLevel: 'debug'` to `useVoiceLive` to trace every event.
 */

import type { LogLevel } from '../types/voiceLive';

/** Logger returned by `createLogger` */
export interface Logger {
  readonly level: LogLevel;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  none: 100,
};

/**
 * Timestamp prefix `HH:MM:SS.mmm` for log lines
 */
export function getTimestamp(now: Date = new Date()): string {
  const pad = (n: number, width = 2): string => n.toString().padStart(width, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

/**
 * Create a leveled logger that prefixes messages with a timestamp and a tag.
 *
 * @param level - Minimum level to print (default 'warn'), or a getter for a level that can change
 * @param prefix - Tag added to every line (default '[VoiceLive]')
 * @param sink - Console-like sink (injectable for tests)
 */
export function createLogger(
  level: LogLevel | (() => LogLevel) = 'warn',
  prefix: string = '[VoiceLive]',
  sink: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console
): Logger {
  const currentLevel = (): LogLevel => (typeof level === 'function' ? level() : level);
  const enabled = (l: LogLevel): boolean =>
    LEVEL_ORDER[l] >= (LEVEL_ORDER[currentLevel()] ?? LEVEL_ORDER.warn);

  return {
    get level(): LogLevel {
      return currentLevel();
    },
    debug: (...args) => {
      if (enabled('debug')) sink.debug(`[${getTimestamp()}] ${prefix}`, ...args);
    },
    info: (...args) => {
      if (enabled('info')) sink.info(`[${getTimestamp()}] ${prefix}`, ...args);
    },
    warn: (...args) => {
      if (enabled('warn')) sink.warn(`[${getTimestamp()}] ${prefix}`, ...args);
    },
    error: (...args) => {
      if (enabled('error')) sink.error(`[${getTimestamp()}] ${prefix}`, ...args);
    },
  };
}
