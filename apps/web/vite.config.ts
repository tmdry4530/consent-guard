import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Fixtures live at the repo root (../../fixtures) and are bundled via JSON imports,
// so `vite preview` works fully offline with no extra file paths.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: { fs: { allow: [repoRoot] } },
});
