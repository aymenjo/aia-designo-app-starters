import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // .env.local en local (npm run env:local) ; en CI, les variables viennent de l'environnement.
    env: loadEnv("test", process.cwd(), ""),
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        // Hors CI : appelle l'API Claude (npm run eval:lecture). La clé est lue, comme par `next dev`,
        // dans .env.development.local.
        test: {
          name: "evaluation",
          include: ["evaluation/**/*.eval.ts"],
          env: loadEnv("development", process.cwd(), ""),
          testTimeout: 30 * 60_000,
        },
      },
    ],
  },
});
