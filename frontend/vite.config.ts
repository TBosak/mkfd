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
      // /public is served by the backend, not by this dev server, even though
      // Vite base is "/public/". That is deliberate: the backend enforces the
      // session gate, so proxying it is what makes E2E exercise a real login.
      // The bundle it serves must therefore be freshly built — "test:e2e"
      // runs the build first, or the suite would test a stale app.
      "/public": { target: "http://localhost:5000", xfwd: true },
      // Self-hosted SelectorGadget assets injected into proxied documents.
      "/vendor": { target: "http://localhost:5000", xfwd: true },
      "/configs": { target: "http://localhost:5000", xfwd: true },
    },
  },
});
