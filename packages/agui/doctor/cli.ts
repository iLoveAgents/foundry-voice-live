#!/usr/bin/env node
/**
 * `foundry-voice-live-agui doctor <url>` — prove an AG-UI endpoint before wiring it to voice.
 *
 * Usage:
 *   foundry-voice-live-agui doctor https://host/agui
 *   foundry-voice-live-agui doctor https://host/agui --bearer $TOKEN
 *   foundry-voice-live-agui doctor https://host/agui --header "x-api-key: abc" --json
 *
 * Exit code is 0 when the endpoint produced a valid AG-UI stream with assistant text, 1 otherwise —
 * so it drops into CI and a proxy healthcheck unchanged.
 */

import { probeEndpoint } from './probe';
import { formatReport } from './format';

interface Args {
  url: string | null;
  headers: Record<string, string>;
  timeoutMs?: number;
  prompt?: string;
  continuity: boolean;
  json: boolean;
  color: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: null,
    headers: {},
    continuity: true,
    json: false,
    color: process.stdout.isTTY ?? false,
  };
  const rest = argv[0] === 'doctor' ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === undefined) continue;
    if (a === '--header' || a === '-H') {
      const raw = rest[++i] ?? '';
      const idx = raw.indexOf(':');
      if (idx > 0) args.headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
    } else if (a === '--bearer') {
      args.headers['authorization'] = `Bearer ${rest[++i] ?? ''}`;
    } else if (a === '--timeout') {
      args.timeoutMs = Number(rest[++i]);
    } else if (a === '--prompt') {
      args.prompt = rest[++i];
    } else if (a === '--no-continuity') {
      args.continuity = false;
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--no-color') {
      args.color = false;
    } else if (a === '--color') {
      args.color = true;
    } else if (!a.startsWith('-') && args.url === null) {
      args.url = a;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    process.stderr.write(
      'usage: foundry-voice-live-agui doctor <url> [--bearer TOKEN] [--header "K: V"] ' +
        '[--timeout MS] [--prompt TEXT] [--no-continuity] [--json]\n'
    );
    process.exit(2);
  }

  const report = await probeEndpoint({
    url: args.url,
    headers: args.headers,
    timeoutMs: args.timeoutMs,
    prompt: args.prompt,
    checkContinuity: args.continuity,
  });

  const out = args.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${formatReport(report, { color: args.color })}\n`;
  // Set exitCode rather than calling process.exit(): a large --json report piped to CI can exceed
  // the pipe buffer, and process.exit() would terminate before stdout finished flushing, truncating
  // the JSON. Setting exitCode lets Node drain stdout and exit on its own.
  await new Promise<void>((resolve) => process.stdout.write(out, () => resolve()));
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(
    `doctor failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(1);
});
