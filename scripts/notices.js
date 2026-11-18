"use strict";
const fs = require("fs");
const path = require("path");

module.exports = function writeNotices(metafile) {
  const packages = new Map();
  function collect(directory) {
    const file = path.join(directory, "package.json");
    if (!fs.existsSync(file)) return;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    const key = `${pkg.name}@${pkg.version}`;
    if (packages.has(key)) return;
    packages.set(key, { pkg, directory });
    for (const name of Object.keys(pkg.dependencies || {})) {
      let base = directory;
      while (true) {
        const candidate = path.join(base, "node_modules", name);
        if (fs.existsSync(path.join(candidate, "package.json"))) {
          collect(candidate);
          break;
        }
        const parent = path.dirname(base);
        if (parent === base) break;
        base = parent;
      }
    }
  }
  for (const name of Object.keys(require("../package.json").dependencies))
    collect(path.resolve("node_modules", name));
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes("node_modules")) continue;
    let directory = path.dirname(path.resolve(input));
    while (directory.includes("node_modules")) {
      if (fs.existsSync(path.join(directory, "package.json"))) {
        collect(directory);
        break;
      }
      directory = path.dirname(directory);
    }
  }
  const parts = [
    "THIRD-PARTY NOTICES\n\nReact Bits public components are integrated into this application, not offered as a component library.\n",
    fs.readFileSync("third-party/ReactBits-LICENSE.txt", "utf8"),
    fs.readFileSync("third-party/react-bits-components.json", "utf8"),
  ];
  for (const [name, { pkg, directory }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    parts.push(
      `\n${"=".repeat(72)}\n${name}\nDeclared license: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}\n`,
    );
    const files = fs
      .readdirSync(directory)
      .filter(
        (name) =>
          /^(licen[cs]e|copyright|notice|thirdpartynotices)([.-]|$)/i.test(name) &&
          fs.statSync(path.join(directory, name)).isFile(),
      );
    for (const name of files)
      parts.push(fs.readFileSync(path.join(directory, name), "utf8"));
    const fallback = {
      gsap: "GSAP-LICENSE.txt",
      "react-remove-scroll-bar": "react-remove-scroll-bar-LICENSE.txt",
    }[pkg.name];
    if (!files.length && fallback)
      parts.push(fs.readFileSync(path.join("third-party", fallback), "utf8"));
    if (!files.length && !fallback)
      parts.push(
        `License text not included in package root; see ${typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || pkg.homepage || pkg.name}.`,
      );
  }
  fs.writeFileSync("public/assets/THIRD-PARTY-NOTICES.txt", parts.join("\n"));
};
