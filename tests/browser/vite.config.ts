import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({ resolve: { alias: { "@owlbear-rodeo/sdk": fileURLToPath(new URL("./mock-sdk.ts", import.meta.url)) } } });
