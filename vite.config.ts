import { defineConfig, type UserConfig } from "vite";
import type { InlineConfig } from "vitest/node";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
const config: UserConfig & { test: InlineConfig } = {
  plugins: [react()],
  build: {
    // Preserve the browser targets used before the Vite upgrade.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/settings": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/skychart.html": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/login": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/utils/**", "server/utils/**"],
    },
  },
};

export default defineConfig(config);
