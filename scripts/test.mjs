// Bundles tests/*.test.ts with esbuild and runs them with Node's built-in test runner.
import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".test.ts"));
const out = path.join(root, ".test-out");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: files.map((f) => path.join(root, "tests", f)),
  outdir: out, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" },
  alias: { "@": root }, logLevel: "warning",
});
const r = spawnSync(process.execPath, ["--test", ...files.map((f) => path.join(out, f.replace(/\.ts$/, ".mjs")))], { stdio: "inherit", env: { ...process.env, TZ: "UTC" } });
process.exit(r.status ?? 1);
