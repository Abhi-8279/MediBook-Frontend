import { build } from "vite";
import { createInlineViteConfig } from "./vite-shared.mjs";

await build(createInlineViteConfig());
