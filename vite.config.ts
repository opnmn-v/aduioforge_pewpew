import { defineConfig } from "vite";

export default defineConfig({
  base: "/aduioforge_pewpew/",
  server: {
    cors: true,
  },
  optimizeDeps: {
    exclude: ["@owlbear-rodeo/sdk"],
    include: ["events"],
  },
  build: {
    rollupOptions: {
      input: { panel: "index.html", background: "background.html" },
    },
  },
});

