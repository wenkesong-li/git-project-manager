"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");

test(
  "desktop sidecar starts on an assigned loopback port with isolated writable paths and offline assets",
  { timeout: 15000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitpm-desktop-test-"));
    const dataDir = path.join(root, "data");
    const workspace = path.join(root, "repositories");
    const child = fork(path.resolve(__dirname, "../server/index.js"), [], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        PORT: "0",
        NO_OPEN: "1",
        GITPM_DESKTOP: "1",
        GITPM_DATA_DIR: dataDir,
        GITPM_WORKSPACE: workspace,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill();
        });
      const resolved = path.resolve(root);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith("gitpm-desktop-test-"));
      fs.rmSync(resolved, { recursive: true, force: true });
    });
    const ready = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Service exited before readiness: ${code}`)),
      );
      child.on("message", (message) => {
        if (message.type === "gitpm-ready") resolve(message);
      });
    });
    const base = new URL(ready.url);
    assert.equal(base.hostname, "127.0.0.1");
    assert.notEqual(base.port, "0");
    const settings = await (await fetch(new URL("/api/settings", base))).json();
    assert.equal(settings.dataDir, dataDir);
    assert.equal(settings.workspace, workspace);
    assert.deepEqual(await (await fetch(new URL("/api/local", base))).json(), {
      items: [],
    });
    for (const asset of [
      "/assets/app.js",
      "/assets/app.css",
      "/assets/theme.js",
      "/assets/THIRD-PARTY-NOTICES.txt",
    ]) {
      const response = await fetch(new URL(asset, base));
      assert.equal(response.status, 200, asset);
      assert.ok((await response.text()).length > 100, asset);
    }
  },
);
