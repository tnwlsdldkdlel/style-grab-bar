import { build } from "esbuild";
import fs from "fs";

const isWatch = process.argv.includes("--watch");

// Build controller (runs in Figma plugin sandbox)
await build({
  entryPoints: ["src/plugin/controller.ts"],
  bundle: true,
  outfile: "dist/controller.js",
  format: "iife",
  target: "es2017",
  minify: false,
});

// Build UI (runs in iframe)
const uiBuild = await build({
  entryPoints: ["src/ui/index.tsx"],
  bundle: true,
  outfile: "dist/ui.js",
  format: "iife",
  target: "es2017",
  minify: !isWatch,
  loader: { ".tsx": "tsx", ".ts": "ts" },
});

// Inline JS into HTML for Figma plugin UI
const uiJs = fs.readFileSync("dist/ui.js", "utf-8");
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>${uiJs}</script>
</body>
</html>`;
fs.writeFileSync("dist/ui.html", html);

console.log("Build complete.");
