import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig(({ mode }) => {
  // Read API_PORT from the repo-root .env (process env wins, e.g. for E2E).
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const apiPort = env.API_PORT || '4000';

  return {
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    server: {
      // CR-05: port 3000 (the Google OAuth client's authorised origin); fail rather than drift to another port.
      port: 3000,
      strictPort: true,
      // Proxy the API so the refresh cookie is same-origin.
      // F13: the notification socket (Socket.IO, WebSocket upgrade) goes through the same origin.
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false },
        '/socket.io': { target: `http://localhost:${apiPort}`, ws: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: `http://localhost:${apiPort}` },
        '/socket.io': { target: `http://localhost:${apiPort}`, ws: true },
      },
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
