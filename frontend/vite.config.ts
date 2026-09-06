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
  // xfwd sends X-Forwarded-Host/For/Proto, matching what a production reverse
  // proxy does. Without it the backend sees only its own internal host and
  // cannot tell which public origin the browser addressed, so the CSRF origin
  // check rejects every state-changing request made through the dev proxy.
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:5000", xfwd: true },
      "/preview": { target: "http://localhost:5000", xfwd: true },
      "/feeds": { target: "http://localhost:5000", xfwd: true },
      "/proxy": { target: "http://localhost:5000", xfwd: true },
      "/passkey": { target: "http://localhost:5000", xfwd: true },
      "/delete-feed": { target: "http://localhost:5000", xfwd: true },
      "/trigger-webhook": { target: "http://localhost:5000", xfwd: true },
      "/imap": { target: "http://localhost:5000", xfwd: true },
      "/utils": { target: "http://localhost:5000", xfwd: true },
      "/public": { target: "http://localhost:5000", xfwd: true },
      "/configs": { target: "http://localhost:5000", xfwd: true },
    },
  },
});
