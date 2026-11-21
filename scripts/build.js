"use strict";
const fs=require('fs'),path=require('path');
const output=path.resolve(__dirname,'../public/assets');
if(path.dirname(output)!==path.resolve(__dirname,'../public'))throw Error('构建目录无效');
fs.rmSync(output,{recursive:true,force:true});
const result = require("esbuild").buildSync({
  entryPoints: { app: 'src/main.jsx' },
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
