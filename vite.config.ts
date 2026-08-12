import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@supabase")) return "supabase";
          if (id.includes("node_modules/react")) return "react";
          return undefined;
        },
      },
      input: {
        main: resolve(projectRoot, "index.html"),
        privacyPolicy: resolve(projectRoot, "privacy-policy.html"),
        notFound: resolve(projectRoot, "404.html"),
      },
    },
  },
});
