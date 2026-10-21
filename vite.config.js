import { defineConfig } from 'vite';

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  build: { chunkSizeWarningLimit: 1600 },
  server: {
    strictPort: true,
    // Mounted Windows workspaces do not consistently emit Linux file events.
    watch: { usePolling: true, interval: 500, ignored: ['**/public/cesium/**'] },
  },
});
