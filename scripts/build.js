"use strict";
const result = require("esbuild").buildSync({
  entryPoints: { app: 'src/main.jsx', ...Object.fromEntries(Object.entries({ editor: 'editor/editor.worker.js', ts: 'language/typescript/ts.worker.js', json: 'language/json/json.worker.js', css: 'language/css/css.worker.js', html: 'language/html/html.worker.js' }).map(([name, file]) => [`worker-${name}`, `node_modules/monaco-editor/esm/vs/${file}`])) },
  bundle: true,
  minify: true,
  outdir: 'public/assets',
  format: 'esm',
  splitting: true,
  loader: { '.ttf': 'file' },
  sourcemap: false,
  target: ["es2020"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  metafile: true,
});
console.log("React 前端构建完成");
require("esbuild").buildSync({
  entryPoints: ["src/theme-init.js"],
  bundle: true,
  minify: true,
  outfile: "public/assets/theme.js",
  target: ["es2020"],
});
require("./notices")(result.metafile);
