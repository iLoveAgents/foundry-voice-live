/**
 * Render a `DoctorReport` as a human-readable block for the CLI, the proxy's startup log, and CI.
 * No colour codes by default (CI logs and file redirects stay clean); pass `{ color: true }` for a
 * TTY.
 */

import type { DoctorReport } from './probe';

export interface FormatOptions {
  color?: boolean;
}

const YES = '✓';
const NO = '✗';
const DASH = '–';

export function formatReport(report: DoctorReport, options: FormatOptions = {}): string {
  const c = makeColor(options.color ?? false);
  const lines: string[] = [];
  const verdict = report.voiceReadiness.verdict;

  lines.push(c.bold(`AG-UI doctor — ${report.url}`));
  lines.push('');
  lines.push(
    `  ${report.ok ? c.green(YES) : c.red(NO)} valid AG-UI stream` +
      (report.ok ? '' : c.red('  (see errors below)'))
  );

  const f = report.features;
  lines.push(`  ${mark(c, f.textStreaming)} text streaming`);
  lines.push(
    `  ${observed(c, f.toolEvents)} tool events${f.toolEvents ? '' : c.dim('  (not observed)')}`
  );
  lines.push(`  ${observed(c, f.state)} state sync${f.state ? '' : c.dim('  (not observed)')}`);
  lines.push(
    `  ${observed(c, f.interrupts)} interrupts / HITL${f.interrupts ? '' : c.dim('  (not observed)')}`
  );
  lines.push(
    `  ${observed(c, f.keepalives)} keepalives${f.keepalives ? '' : c.dim('  (none seen)')}`
  );
  lines.push(`  ${continuity(c, f.threadContinuity)} thread continuity (parentRunId)`);

  lines.push('');
  lines.push(c.bold('  Timing'));
  lines.push(`    first token: ${fmtMs(report.timing.firstTokenMs)}`);
  lines.push(`    full answer: ${fmtMs(report.timing.totalMs)}`);

  lines.push('');
  const vr = report.voiceReadiness;
  const badge =
    verdict === 'ready'
      ? c.green('READY')
      : verdict === 'usable'
        ? c.yellow('USABLE')
        : c.red('UNFIT');
  lines.push(`  ${c.bold('Voice readiness:')} ${badge}`);
  lines.push(
    `    ${vr.chunkableDeltas ? YES : DASH} speakable chunks   answer: ${vr.answerCharCount} chars`
  );
  for (const reason of vr.reasons) lines.push(`    ${c.dim('•')} ${reason}`);

  if (report.errors.length > 0) {
    lines.push('');
    lines.push(c.red(c.bold('  Errors')));
    for (const e of report.errors) lines.push(`    ${c.red(NO)} ${e}`);
  }

  lines.push('');
  return lines.join('\n');
}

function mark(c: Color, ok: boolean): string {
  return ok ? c.green(YES) : c.red(NO);
}
function observed(c: Color, seen: boolean): string {
  return seen ? c.green(YES) : c.dim(DASH);
}
function continuity(c: Color, v: boolean | null): string {
  if (v === null) return c.dim(DASH);
  return v ? c.green(YES) : c.red(NO);
}
function fmtMs(ms: number | null): string {
  return ms === null ? 'n/a' : `${ms} ms`;
}

interface Color {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
}

function makeColor(enabled: boolean): Color {
  const wrap = (code: string) => (s: string) => (enabled ? `\u001b[${code}m${s}\u001b[0m` : s);
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    green: wrap('32'),
    red: wrap('31'),
    yellow: wrap('33'),
  };
}
