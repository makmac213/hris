// Bundles the prototype into one self-contained HTML file: dist/preview/index.html
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = await build({
  entryPoints: [path.join(root, "preview/main.tsx")],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  target: "es2020",
  tsconfig: path.join(root, "tsconfig.json"),
  alias: {
    "next/link": path.join(root, "preview/shims/link.tsx"),
    "next/navigation": path.join(root, "preview/shims/navigation.ts"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = await readFile(path.join(root, "styles/globals.css"), "utf8");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Halden HRIS prototype</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;
await mkdir(path.join(root, "dist/preview"), { recursive: true });
await writeFile(path.join(root, "dist/preview/index.html"), html);
console.log(`dist/preview/index.html ${(html.length / 1024).toFixed(0)} KB`);
