import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Dev mode: Use source files via alias (fast iteration)
// Dist mode: Use built package (test actual npm output)
const isDist = process.env.VITE_MODE === 'dist';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
  },
  resolve: {
    // Subpath aliases must come before the bare package alias so `/react` etc. match first.
    alias: isDist
      ? {
          '@iloveagents/foundry-voice-live-react': path.resolve(
            __dirname,
            '../packages/react/dist/index.mjs'
          ),
        }
      : {
          '@iloveagents/foundry-voice-live-agui/react': path.resolve(
            __dirname,
            '../packages/agui/react/index.ts'
          ),
          '@iloveagents/foundry-voice-live-agui/core': path.resolve(
            __dirname,
            '../packages/agui/core/index.ts'
          ),
          '@iloveagents/foundry-voice-live-agui/doctor': path.resolve(
            __dirname,
            '../packages/agui/doctor/index.ts'
          ),
          '@iloveagents/foundry-voice-live-agui': path.resolve(
            __dirname,
            '../packages/agui/index.ts'
          ),
          '@iloveagents/foundry-voice-live-react': path.resolve(
            __dirname,
            '../packages/react/index.ts'
          ),
        },
  },
});
