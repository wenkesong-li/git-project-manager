"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseStatus } = require("../server/status");
const git = require("../server/git");

test("porcelain -z preserves filenames and consumes rename sources", () => {
  const items = parseStatus(
    " M 中文 文件.txt\0R  新 -> 文件.txt\0旧文件.txt\0?? nested/new.txt\0UU conflict.txt\0",
  );
  assert.deepEqual(
    items.map((item) => item.path),
    ["中文 文件.txt", "新 -> 文件.txt", "nested/new.txt", "conflict.txt"],
  );
  assert.equal(items[1].staged, true);
  assert.equal(items[3].state, "conflict");
  assert.equal(items[3].staged, false);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitpm-test-"));
  execFileSync("git", ["init", "-q", root], { windowsHide: true });
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("gitpm-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const project = { id: 1, name: "fixture", local_path: root };
  const db = new (require('../server/sqlite'))(':memory:');
  t.after(() => db.close());
  const fileOps = require('../server/file-operations')(db, path.join(root, '.git', 'test-trash'));
  const routes = new Map();
  require("../server/routes/local")(
    (method, url, handler) => routes.set(`${method} ${url}`, handler),
    {
      dbm: { getProject: () => project },
      bus: { log() {} },
      fileOps,
    },
  );
  return {
    root,
    call: (method, url, body = {}, query = {}) =>
      routes.get(`${method} ${url}`)({
        params: { id: 1 },
        body,
        query: new URLSearchParams(query),
      }),
  };
}

test("new repositories support nested files, staged diff, unstage and empty history", async (t) => {
  const { root, call } = fixture(t);
  fs.mkdirSync(path.join(root, "目录"));
  fs.writeFileSync(path.join(root, "目录", "文件..txt"), "第一行\n第二行\n");
  const changes = await call("GET", "/api/local/:id/changes");
  assert.deepEqual(changes.items, [
    { path: "目录/文件..txt", state: "added", staged: false },
  ]);
  assert.equal(await git.dirtyCount(root), 1);
  await call("POST", "/api/local/:id/stage", { paths: ["目录/文件..txt"] });
  const diff = await call(
    "GET",
    "/api/local/:id/diff",
    {},
    { path: "目录/文件..txt" },
  );
  assert.match(diff.text, /\+第一行/);
  await call("POST", "/api/local/:id/stage", {
    paths: ["目录/文件..txt"],
    unstage: true,
  });
  assert.ok(fs.existsSync(path.join(root, "目录", "文件..txt")));
  const updated = await call("GET", "/api/local/:id/changes");
  assert.equal(updated.items[0].staged, false);
  assert.deepEqual(await call("GET", "/api/local/:id/log"), { items: [] });
});

test("rename and newline-containing filenames are not split into extra changes", async (t) => {
  const { root, call } = fixture(t);
  fs.writeFileSync(path.join(root, "旧 文件.txt"), "original\n");
  execFileSync("git", ["add", "."], { cwd: root, windowsHide: true });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "initial",
    ],
    { cwd: root, windowsHide: true },
  );
  execFileSync("git", ["mv", "旧 文件.txt", "新 文件.txt"], {
    cwd: root,
    windowsHide: true,
  });
  const result = await call("GET", "/api/local/:id/changes");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].path, "新 文件.txt");
  assert.equal(await git.dirtyCount(root), 1);
  assert.equal(parseStatus("?? line\nbreak.txt\0").length, 1);
});

test("file access rejects traversal and git metadata but allows dots in filenames", async (t) => {
  const { root, call } = fixture(t);
  for (const file of [
    "../outside",
    "..\\outside",
    ".git/config",
    "C:\\outside",
    "\\outside",
    "/outside",
  ]) {
    await assert.rejects(
      call("GET", "/api/local/:id/file", {}, { path: file }),
      /非法文件路径/,
    );
  }
  fs.writeFileSync(path.join(root, "valid..txt"), "valid");
  assert.equal(
    (await call("GET", "/api/local/:id/file", {}, { path: "valid..txt" }))
      .content,
    "valid",
  );
});

test("file browser lists unchanged, hidden and ignored files and paginates large folders", async (t) => {
  const { root, call } = fixture(t);
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
  fs.writeFileSync(path.join(root, ".env"), "fixture=true");
  fs.writeFileSync(path.join(root, "-notes.txt"), "readable");
  fs.mkdirSync(path.join(root, "ignored"));
  fs.writeFileSync(path.join(root, "ignored", "隐藏 文件.txt"), "预览内容\n");
  fs.mkdirSync(path.join(root, "many"));
  for (let i = 0; i < 205; i++)
    fs.writeFileSync(path.join(root, "many", `${i}.txt`), "test");
  const list = await call("GET", "/api/local/:id/files");
  assert.ok(list.items.some((item) => item.name === ".env"));
  assert.ok(
    list.items.some(
      (item) => item.name === "ignored" && item.type === "directory",
    ),
  );
  assert.ok(!list.items.some((item) => item.name === ".git"));
  const first = await call("GET", "/api/local/:id/files", {}, { path: "many" });
  const next = await call(
    "GET",
    "/api/local/:id/files",
    {},
    { path: "many", offset: "200" },
  );
  assert.equal(first.items.length, 200);
  assert.equal(first.hasMore, true);
  assert.equal(next.items.length, 5);
  assert.equal(next.hasMore, false);
  assert.equal(
    new Set([...first.items, ...next.items].map((item) => item.path)).size,
    205,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/api/local/:id/file",
        {},
        { path: "ignored/隐藏 文件.txt" },
      )
    ).content,
    "预览内容\n",
  );
  assert.equal(
    (await call("GET", "/api/local/:id/file", {}, { path: "-notes.txt" }))
      .content,
    "readable",
  );
});

test("file browser rejects external links and previews raster images without exposing Git metadata", async (t) => {
  const { root, call } = fixture(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "gitpm-files-outside-"),
  );
  t.after(() => {
    const resolved = path.resolve(outside);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("gitpm-files-outside-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, "private.txt"), "outside fixture");
  fs.symlinkSync(
    outside,
    path.join(root, "external"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const list = await call("GET", "/api/local/:id/files");
  assert.equal(
    list.items.find((item) => item.name === "external").accessible,
    false,
  );
  await assert.rejects(
    call("GET", "/api/local/:id/files", {}, { path: "external" }),
    /仓库外/,
  );
  await assert.rejects(
    call("GET", "/api/local/:id/file", {}, { path: "external/private.txt" }),
    /仓库外/,
  );
  await assert.rejects(
    call("GET", "/api/local/:id/files", {}, { path: ".git" }),
    /非法文件路径/,
  );
  fs.writeFileSync(
    path.join(root, "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC/0AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const preview = await call(
    "GET",
    "/api/local/:id/file",
    {},
    { path: "pixel.png" },
  );
  assert.equal(preview.binary, true);
  assert.match(preview.image, /^data:image\/png;base64,/);
});
