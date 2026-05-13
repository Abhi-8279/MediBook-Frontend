import { createServer } from "vite";
import { createInlineViteConfig } from "./vite-shared.mjs";

const server = await createServer(createInlineViteConfig());
await server.listen();
server.printUrls();
