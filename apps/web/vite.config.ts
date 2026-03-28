import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["pixi.js", "pixi-live2d-display/cubism4"],
    // TalkingHead dynamically imports lipsync-*.mjs at runtime.
    // Exclude it from optimize pre-bundling to avoid missing deps warnings.
    exclude: ["@met4citizen/talkinghead", "pinyin2ipa", "pinyin-separate"]
  },
  server: {
    port: 5173
  }
});
