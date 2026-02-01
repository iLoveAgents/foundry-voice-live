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
    alias: isDist
      ? {
          '@iloveagents/foundry-voice-live-react': path.resolve(__dirname, '../packages/react/dist/index.mjs'),
        }
      : {
          '@iloveagents/foundry-voice-live-react': path.resolve(__dirname, '../packages/react/index.ts'),
        },
  },
});
