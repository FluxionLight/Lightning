import { defineConfig } from "vite";
export default defineConfig({
  clearScreen: false,
  server: { port: 1423, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/release/**"] } },
});
