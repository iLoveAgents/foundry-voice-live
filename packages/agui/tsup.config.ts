import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'index.ts',
    'core/index': 'core/index.ts',
    'react/index': 'react/index.ts',
    'doctor/index': 'doctor/index.ts',
    cli: 'doctor/cli.ts',
  },
  format: ['esm', 'cjs'],
  // The CLI is an executable, not an importable module — it needs no shipped .d.ts, and excluding
  // it keeps Node globals (`process`) out of the declaration build. Library entries get full types.
  dts: {
    entry: {
      index: 'index.ts',
      'core/index': 'core/index.ts',
      'react/index': 'react/index.ts',
      'doctor/index': 'doctor/index.ts',
    },
  },
  sourcemap: true,
  clean: true,
  // Everything a consumer already has (or must provide) stays external: a duplicated
  // @ag-ui/client or rxjs would break observable interop, and React must be theirs.
  external: [
    'react',
    'react-dom',
    'rxjs',
    '@ag-ui/client',
    '@ag-ui/core',
    '@iloveagents/foundry-voice-live-react',
  ],
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2020',
});
