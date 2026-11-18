"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("remote adapters pass each page size and page number without skipping records", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  for (const provider of ["github", "gitlab", "gitee"]) {
    for (const pageSize of [10, 20, 50, 100]) {
      const requests = [];
      global.fetch = async (request) => {
        const url = new URL(request);
        requests.push(url);
        const size = Number(url.searchParams.get("per_page"));
        const page = Number(url.searchParams.get("page"));
        const items = Array.from({ length: size }, (_, i) => {
          const id = (page - 1) * size + i + 1;
          return {
            id,
            name: `repo-${id}`,
            path: `repo-${id}`,
            full_name: `team/repo-${id}`,
            clone_url: `https://example.test/team/repo-${id}.git`,
            http_url_to_repo: `https://example.test/team/repo-${id}.git`,
            html_url: `https://example.test/team/repo-${id}`,
          };
        });
        return {
          ok: true,
          text: async () =>
            JSON.stringify(url.pathname.includes("search") ? { items } : items),
        };
      };
      const adapter = require(`../server/adapters/${provider}`)({
        baseUrl: "https://example.test",
        token: "",
      });
      const first = await adapter.listProjects({ page: 1, pageSize });
      const second = await adapter.listProjects({
        page: 2,
        pageSize,
        search: provider === "github" ? "team" : "",
      });
      assert.equal(first.items.length, pageSize);
      assert.equal(second.items.length, pageSize);
      assert.equal(first.hasMore, true);
      assert.notEqual(first.items.at(-1).id, second.items[0].id);
      assert.deepEqual(
        requests.map((url) => [
          url.searchParams.get("per_page"),
          url.searchParams.get("page"),
        ]),
        [
          [String(pageSize), "1"],
          [String(pageSize), "2"],
        ],
      );
    }
  }
});

test("Codeup paginates both direct lists and filtered results at every page size", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const all = Array.from({ length: 138 }, (_, i) => ({
    id: String(i + 1),
    name: `match-${i + 1}`,
    path: `match-${i + 1}`,
    webUrl: `https://example.test/org/team/match-${i + 1}`,
  }));
  global.fetch = async (_, options) => {
    const { params } = JSON.parse(options.body);
    assert.equal(params.name, "list_repositories");
    const { page, perPage } = params.arguments;
    const rows = all.slice((page - 1) * perPage, page * perPage);
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          result: { content: [{ type: "text", text: JSON.stringify(rows) }] },
        }),
    };
  };
  const adapter = require("../server/adapters/codeup")({
    token: "",
    orgId: "org",
  });
  for (const pageSize of [10, 20, 50, 100]) {
    for (const search of ["", "match"]) {
      const first = await adapter.listProjects({ page: 1, pageSize, search });
      const second = await adapter.listProjects({ page: 2, pageSize, search });
      assert.deepEqual(
        first.items.map((item) => item.id),
        all.slice(0, pageSize).map((item) => item.id),
      );
      assert.deepEqual(
        second.items.map((item) => item.id),
        all.slice(pageSize, pageSize * 2).map((item) => item.id),
      );
      if (search) assert.equal(second.total, 138);
    }
  }
});

test("desktop defaults keep writable data outside application resources", () => {
  const path = require("path");
  const { resolvePaths } = require("../server/paths");
  const paths = resolvePaths({ GITPM_DESKTOP: "1" }, { versions: {} });
  assert.equal(path.basename(paths.DEFAULT_WORKSPACE), "GitProjects");
  assert.equal(path.basename(paths.DATA_DIR), ".gitpm");
  assert.notEqual(path.dirname(paths.DATA_DIR), paths.APP_ROOT);
  const configured = resolvePaths(
    {
      GITPM_DATA_DIR: path.join(paths.DATA_DIR, "custom"),
      GITPM_WORKSPACE: path.join(paths.DEFAULT_WORKSPACE, "custom"),
    },
    { versions: {} },
  );
  assert.equal(path.basename(configured.DATA_DIR), "custom");
  assert.equal(path.basename(configured.DEFAULT_WORKSPACE), "custom");
});
