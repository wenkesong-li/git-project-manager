import React from "react";
import { Checkbox, Input } from "./ui-kit";
import { IconFolder, IconSearch } from "./icons";

export default function SidebarProjects({
  projects,
  query,
  onQuery,
  selection,
  setSelection,
  route,
  navigate,
  disabled,
}) {
  const selectedVisible = projects.filter((project) =>
    selection.includes(String(project.id)),
  ).length;
  return (
    <>
      <div className="sidebar-search">
        <Input
          prefix={<IconSearch />}
          aria-label="搜索左侧项目"
          placeholder="搜索名称、路径、分支"
          value={query}
          onChange={onQuery}
          allowClear
        />
      </div>
      <div className="sidebar-select-row">
        <Checkbox
          aria-label="全选左侧搜索结果"
          disabled={!projects.length || disabled}
          checked={!!projects.length && selectedVisible === projects.length}
          indeterminate={
            selectedVisible > 0 && selectedVisible < projects.length
          }
          onChange={(checked) =>
            setSelection((previous) =>
              checked
                ? [
                    ...new Set([
                      ...previous,
                      ...projects.map((project) => String(project.id)),
                    ]),
                  ]
                : previous.filter(
                    (id) =>
                      !projects.some((project) => String(project.id) === id),
                  ),
            )
          }
        >
          全选结果
        </Checkbox>
        <span>{projects.length} 个</span>
      </div>
      <div className="nav-projects">
        {projects.map((project) => (
          <div className="side-project-row" key={project.id}>
            <Checkbox
              aria-label={`侧栏选择 ${project.name} ${project.local_path}`}
              disabled={disabled}
              checked={selection.includes(String(project.id))}
              onChange={(checked) =>
                setSelection((previous) =>
                  checked
                    ? [...new Set([...previous, String(project.id)])]
                    : previous.filter((id) => id !== String(project.id)),
                )
              }
            />
            <button
              title={project.local_path}
              className={`nav-item ${route.type === "project" && route.id === String(project.id) ? "active" : ""}`}
              onClick={() => navigate("project", project.id)}
            >
              <IconFolder />
              <span className="nav-name">{project.name}</span>
              {(!project.exists || project.dirty > 0) && (
                <i
                  className={`status-dot ${!project.exists ? "bad" : "warn"}`}
                />
              )}
            </button>
          </div>
        ))}
      </div>
      {!projects.length && (
        <div className="sidebar-no-results">
          {query ? "没有匹配的项目" : "暂无本地项目"}
        </div>
      )}
    </>
  );
}
