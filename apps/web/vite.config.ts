import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ["pixi.js", "pixi-live2d-display/cubism4"]
  },
  server: {
    port: 5173
  }
});
