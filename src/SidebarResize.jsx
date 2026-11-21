import React, { useRef, useState } from "react";

const DEFAULT_WIDTH = 232;
export function initialSidebarWidth() {
  try {
    const saved = Number(
      localStorage.getItem("gpm-sidebar-width") || DEFAULT_WIDTH,
    );
    return Number.isFinite(saved)
      ? Math.max(180, Math.min(520, saved))
      : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}
export default function SidebarResize({ sidebarRef, width, onChange, storageKey = "gpm-sidebar-width", label = "调整左侧宽度", containerRef }) {
  const drag = useRef(null),
    [dragging, setDragging] = useState(false);
  function limits() {
    const scale = sidebarRef.current
      ? sidebarRef.current.getBoundingClientRect().width /
        sidebarRef.current.offsetWidth
      : 1;
    return {
      scale,
      max: Math.max(180, Math.min(520, containerRef ? containerRef.current.offsetWidth * .45 : window.innerWidth / scale - 400)),
    };
  }
  function update(value, persist = false) {
    const next = Math.round(Math.max(180, Math.min(limits().max, value)));
    onChange(next);
    if (drag.current) drag.current.width = next;
    if (persist) {
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {}
    }
  }
  function finish(event) {
    if (!drag.current) return;
    update(drag.current.width, true);
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <div
      className={`sidebar-resizer ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={520}
      aria-valuenow={width}
      tabIndex={0}
      title="拖动调整侧栏；双击恢复默认；左右方向键微调"
      onDoubleClick={() => update(DEFAULT_WIDTH, true)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const { scale } = limits();
        drag.current = {
          x: event.clientX,
          start: sidebarRef.current.offsetWidth,
          width: sidebarRef.current.offsetWidth,
          scale,
        };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          update(
            drag.current.start +
              (event.clientX - drag.current.x) / drag.current.scale,
          );
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={() => {
        if (drag.current) {
          update(drag.current.width, true);
          drag.current = null;
        }
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        update(
          event.key === "Home"
            ? 180
            : event.key === "End"
              ? limits().max
              : width + (event.key === "ArrowRight" ? 16 : -16),
          true,
        );
      }}
    />
  );
}
