import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/public/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: false, // Don't delete feeds/ folder and existing assets
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/index.[ext]",
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/preview": "http://localhost:5000",
      "/feeds": "http://localhost:5000",
      "/proxy": "http://localhost:5000",
      "/passkey": "http://localhost:5000",
      "/delete-feed": "http://localhost:5000",
      "/trigger-webhook": "http://localhost:5000",
      "/imap": "http://localhost:5000",
      "/utils": "http://localhost:5000",
      "/public": "http://localhost:5000",
      "/configs": "http://localhost:5000",
    },
  },
});
