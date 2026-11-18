import React from "react";
import { THEMES, DEFAULT_THEME } from "./themes";

export default function ThemePicker({ value, onChange }) {
  return (
    <div className="theme-picker" role="group" aria-label="主题预设">
      {THEMES.map((theme) => (
        <button
          type="button"
          key={theme.id}
          className={`theme-option ${value === theme.id ? "selected" : ""}`}
          aria-pressed={value === theme.id}
          aria-label={`${theme.name}主题`}
          onClick={() => onChange(theme.id)}
        >
          <span
            className="theme-preview"
            aria-hidden="true"
            style={{
              background: theme.colors[0],
              borderColor: theme.colors[7],
            }}
          >
            <span
              className="theme-preview-nav"
              style={{ background: theme.colors[1] }}
            >
              <i style={{ background: theme.colors[8] }} />
              <i style={{ background: theme.colors[7] }} />
              <i style={{ background: theme.colors[7] }} />
            </span>
            <span className="theme-preview-content">
              <i style={{ background: theme.colors[8] }} />
              <i style={{ background: theme.colors[7] }} />
              <i style={{ background: theme.colors[7] }} />
            </span>
            {value === theme.id && (
              <span
                className="theme-check"
                style={{ color: theme.colors[0], background: theme.colors[8] }}
              >
                ✓
              </span>
            )}
          </span>
          <span className="theme-option-name">
            {theme.name}
            <small>
              {theme.id === DEFAULT_THEME
                ? "默认"
                : theme.mode === "dark"
                  ? "深色"
                  : "浅色"}
            </small>
          </span>
          <small className="theme-description">{theme.description}</small>
        </button>
      ))}
    </div>
  );
}
