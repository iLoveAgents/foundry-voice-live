/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi } from 'vitest';
import { createLogger, getTimestamp } from './logger';

const makeSink = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('createLogger', () => {
  it('is quiet below warn by default', () => {
    const sink = makeSink();
    const log = createLogger(undefined, '[T]', sink);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(log.level).toBe('warn');
  });

  it('prints everything at debug and nothing at none', () => {
    const sink = makeSink();
    const dbg = createLogger('debug', '[T]', sink);
    dbg.debug('d');
    dbg.info('i');
    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(sink.info).toHaveBeenCalledTimes(1);

    const none = createLogger('none', '[T]', sink);
    none.error('e');
    expect(sink.error).not.toHaveBeenCalled();
  });

  it('prefixes lines with a timestamp and tag', () => {
    const sink = makeSink();
    createLogger('info', '[Tag]', sink).info('hello', 42);
    const [prefix, ...rest] = sink.info.mock.calls[0]!;
    expect(prefix).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[Tag\]$/);
    expect(rest).toEqual(['hello', 42]);
  });
});

describe('createLogger with a level getter', () => {
  it('re-reads the level on every call', () => {
    const sink = makeSink();
    let level: 'warn' | 'debug' = 'warn';
    const log = createLogger(() => level, '[T]', sink);
    log.debug('hidden');
    expect(sink.debug).not.toHaveBeenCalled();
    level = 'debug';
    log.debug('shown');
    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(log.level).toBe('debug');
  });
});

describe('getTimestamp', () => {
  it('formats HH:MM:SS.mmm', () => {
    expect(getTimestamp(new Date(2026, 0, 1, 9, 5, 7, 42))).toBe('09:05:07.042');
  });
});
