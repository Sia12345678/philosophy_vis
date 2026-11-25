import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    open: false,
    proxy: {
      "/api": {
        target: "https://wherephilosophygoes.ucfnshu.workers.dev",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
