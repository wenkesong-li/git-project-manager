// Adapted for repository previews from React Bits Accordion Gallery.
// https://reactbits.dev/components/accordion-gallery (see third-party/ReactBits-LICENSE.txt)
import React, { useRef, useLayoutEffect, useState } from "react";
import { gsap } from "gsap";

export default function AccordionGallery({ items, onOpen }) {
  const root = useRef(null);
  const hasRendered = useRef(false);
  const [activeId, setActiveId] = useState(null);
  const active = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );
  useLayoutEffect(() => {
    const element = root.current;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = element.clientWidth;
    const layout = (immediate = false) => {
      const duration =
        immediate || !hasRendered.current || mediaQuery.matches ? 0 : 0.6;
      const count = items.length;
      const grow = count > 1 ? (0.52 * (count - 1)) / (1 - 0.52) : 1;
      Array.from(element.children).forEach((panel, i) => {
        const selected = i === active;
        gsap.to(panel, {
          flexGrow: selected ? grow : 1,
          duration,
          ease: "power3.out",
          overwrite: true,
        });
        gsap.to(panel.querySelector(".ag-media"), {
          x:
            selected || mediaQuery.matches
              ? 0
              : Math.max(-1.5, Math.min(1.5, active - i)) * 18,
          scale: selected ? 1 : 1.08,
          opacity: selected ? 0.8 : 0.3,
          duration,
          ease: "power3.out",
          overwrite: true,
        });
        gsap.to(panel.querySelector(".ag-caption"), {
          autoAlpha: selected ? 1 : 0,
          y: selected ? 0 : 14,
          duration: duration * 0.75,
          overwrite: true,
        });
      });
      hasRendered.current = true;
    };
    layout();
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) {
        width = element.clientWidth;
        layout(true);
      }
    });
    observer.observe(element);
    const motionChanged = () => layout(true);
    mediaQuery.addEventListener("change", motionChanged);
    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", motionChanged);
      gsap.killTweensOf([
        ...element.children,
        ...element.querySelectorAll(".ag-media, .ag-caption"),
      ]);
    };
  }, [active, items.map((item) => item.id).join(",")]);
  function navigate(event, i) {
    const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in offset) && event.key !== "Home" && event.key !== "End")
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (i + offset[event.key] + items.length) % items.length;
    setActiveId(items[next].id);
    root.current.children[next].querySelector(".ag-select").focus();
  }
  return (
    <div
      className="accordion-gallery"
      ref={root}
      aria-label="最近项目，方向键切换"
    >
      {items.map((p, i) => (
        <article
          key={p.id}
          className={`ag-panel ${active === i ? "is-active" : ""}`}
          style={{
            "--panel-tone": `var(--gallery-tone-${(i % 5) + 1})`,
            background: `var(--gallery-panel-${(i % 5) + 1})`,
          }}
          onMouseEnter={() => {
            if (
              matchMedia("(hover: hover)").matches &&
              !root.current.contains(document.activeElement)
            )
              setActiveId(p.id);
          }}
        >
          <div className="ag-media" aria-hidden="true">
            <svg
              viewBox="0 0 520 300"
              fill="none"
              preserveAspectRatio="xMidYMid slice"
            >
              <path
                d="M-20 230H140Q180 230 180 190V70Q180 30 220 30H550M-20 230H240Q280 230 280 190V150Q280 110 320 110H550M-20 230H550"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M-20 250H160Q200 250 200 210V90Q200 50 240 50H550M-20 250H260Q300 250 300 210V170Q300 130 340 130H550"
                stroke="currentColor"
                strokeOpacity=".2"
              />
              <g fill="currentColor">
                <circle cx="180" cy="100" r="5" />
                <circle cx="280" cy="175" r="5" />
                <circle cx="390" cy="230" r="5" />
                <circle cx="420" cy="110" r="5" />
                <circle cx="330" cy="30" r="5" />
              </g>
              <g
                fontFamily="Consolas,monospace"
                fontSize="10"
                fill="currentColor"
                opacity=".6"
              >
                <text x="195" y="105">
                  commit
                </text>
                <text x="296" y="180">
                  merge
                </text>
                <text x="365" y="253">
                  HEAD
                </text>
              </g>
            </svg>
          </div>
          <button
            className="ag-select"
            aria-label={`展开 ${p.name}`}
            aria-expanded={active === i}
            onClick={() => setActiveId(p.id)}
            onFocus={() => setActiveId(p.id)}
            onKeyDown={(event) => navigate(event, i)}
          >
            <span className="ag-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="ag-collapsed-name">{p.name}</span>
            <span className="ag-plus">{active === i ? "−" : "+"}</span>
          </button>
          <div className="ag-caption" inert={active !== i ? "" : undefined}>
            <span className="ag-kicker">⎇ {p.branch || "DETACHED HEAD"}</span>
            <h3>{p.name}</h3>
            <p title={p.local_path}>{p.local_path}</p>
            <div className="ag-caption-foot">
              <span>
                {!p.exists
                  ? "目录丢失"
                  : p.dirty < 0
                    ? "状态不可用"
                    : p.dirty > 0
                      ? `${p.dirty} 个文件待提交`
                      : "工作区干净"}
              </span>
              <button
                onClick={() => onOpen(p.id)}
                onKeyDown={(event) => navigate(event, i)}
              >
                打开项目 ↗
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
