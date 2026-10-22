import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src-ui/src/test/setup.ts"],
    include: ["src-ui/**/*.test.ts", "src-ui/**/*.test.tsx"],
  },
});
