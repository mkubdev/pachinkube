// Copy three's Draco decoder into public/ so the viewer works offline.
// Assets are Draco-compressed, so the decoder is required, not optional.
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/three/examples/jsm/libs/draco");
const dest = resolve(root, "public/draco");

if (!existsSync(src)) {
  console.error("three not installed yet - skipping Draco decoder copy");
  process.exit(0);
}
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Draco decoder -> ${dest}`);
