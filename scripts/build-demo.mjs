// Bundle the demo into one self-contained HTML file (no external JS).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const out = await build({ entryPoints: ["demo/app.js"], bundle: true, format: "iife", minify: true, write: false, target: "es2020", loader: { ".json": "json" } });
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const body = readFileSync("demo/template.html", "utf8").replace("<script>__APP__</script>", () => `<script>${js}</script>`);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/artifact.html", body);
const [head, rest] = [body.slice(0, body.indexOf("<div class=\"wrap\">")), body.slice(body.indexOf("<div class=\"wrap\">"))];
const page = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}</head>\n<body>\n${rest}</body>\n</html>\n`;
writeFileSync("dist/index.html", page);
writeFileSync("index.html", page); // GitHub Pages serves the repo root
console.log(`dist/index.html ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`);
