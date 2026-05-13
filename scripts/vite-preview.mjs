import { preview } from "vite";
import { createInlineViteConfig } from "./vite-shared.mjs";

const server = await preview(createInlineViteConfig());
server.printUrls();
