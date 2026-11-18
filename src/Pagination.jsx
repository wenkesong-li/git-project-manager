import React, { useState } from "react";
import { Button, Select } from "./ui-kit";

export const PAGE_SIZES = [10, 20, 50, 100];
export function usePageSize(scope) {
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(`gpm-page-size-${scope}`));
      return PAGE_SIZES.includes(saved) ? saved : 20;
    } catch {
      return 20;
    }
  });
  return [
    size,
    (value) => {
      setSize(value);
      try {
        localStorage.setItem(`gpm-page-size-${scope}`, String(value));
      } catch {}
    },
  ];
}
export default function Pagination({
  page,
  pageSize,
  count,
  total,
  hasMore,
  loading,
  onPage,
  onPageSize,
}) {
  const knownTotal = Number.isFinite(total);
  const pages = knownTotal ? Math.max(1, Math.ceil(total / pageSize)) : null;
  return (
    <div className="pagination">
      <span className="muted">
        {loading
          ? "正在加载…"
          : knownTotal
            ? `共 ${total} 条 · 第 ${page}/${pages} 页`
            : `第 ${page} 页 · 本页 ${count} 条`}
      </span>
      <Select
        aria-label="每页条数"
        size="small"
        style={{ width: 112 }}
        value={pageSize}
        disabled={loading}
        onChange={onPageSize}
        options={PAGE_SIZES.map((value) => ({
          value,
          label: `${value} 条 / 页`,
        }))}
      />
      <Button
        size="small"
        disabled={loading || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </Button>
      <Button
        size="small"
        disabled={loading || (knownTotal ? page >= pages : !hasMore)}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}
