// vitest/config re-exports Vite's defineConfig with the `test` key typed.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { vercelApiDev } from "./tools/vite-api";

export default defineConfig({
  plugins: [vercelApiDev()],
  resolve: {
    alias: {
      "@sim": fileURLToPath(new URL("./src/sim", import.meta.url)),
      "@render": fileURLToPath(new URL("./src/render", import.meta.url)),
    },
  },
  build: {
    // Rapier + three + postprocessing; top-level await in main.ts is fine here.
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
