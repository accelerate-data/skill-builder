import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const isE2E = process.env.TAURI_E2E === "true";
// @ts-expect-error process is a nodejs global
const devPort = parseInt(process.env.DEV_PORT || "1420") || 1420;
if (devPort < 1 || devPort > 65534) {
  throw new Error(`DEV_PORT must be between 1 and 65534 (got ${devPort}). HMR needs port ${devPort + 1}.`);
}
const hmrPort = devPort + 1;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // In E2E mode, replace Tauri invoke with mock responses
      ...(isE2E && {
        "@tauri-apps/api/core": path.resolve(__dirname, "./src/test/mocks/tauri-e2e.ts"),
        "@tauri-apps/api/event": path.resolve(__dirname, "./src/test/mocks/tauri-e2e-event.ts"),
        "@tauri-apps/api/window": path.resolve(__dirname, "./src/test/mocks/tauri-e2e-window.ts"),
        "@tauri-apps/plugin-dialog": path.resolve(__dirname, "./src/test/mocks/tauri-e2e-dialog.ts"),
      }),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
