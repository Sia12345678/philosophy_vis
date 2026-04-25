import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    open: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
