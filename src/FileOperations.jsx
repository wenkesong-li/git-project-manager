import React, { useEffect, useState } from "react";
import { Button, Modal, Message } from "./ui-kit";
import { get, post, confirm } from "./api";
import { Resource, useAction, useResource } from "./ui";
const labels = {
  save: "保存",
  delete: "删除",
  restore: "恢复",
  format: "格式化",
  copy: "复制",
};
export default function FileOperations({ id, onClose, onRestore, version }) {
  const resource = useResource(
    (signal) => get(`/api/local/${id}/file-operations`, signal),
    [id, version],
  );
  const [extra, setExtra] = useState([]),
    [more, setMore] = useState(false),
    [busy, run] = useAction();
  useEffect(() => {
    setExtra([]);
    setMore(resource.data?.hasMore || false);
  }, [resource.data]);
  const items = [...(resource.data?.items || []), ...extra];
  return (
    <Modal
      visible
      title="文件操作记录"
      footer={null}
      style={{ width: 900, maxWidth: "calc(100vw - 24px)" }}
      onCancel={onClose}
    >
      <p className="section-note">
        保存、格式化、复制和删除记录会保留在本机。删除文件可在这里恢复；记录不包含文件或剪贴板内容。
      </p>
      <Resource resource={resource}>
        {() =>
          items.length ? (
            <div className="file-operations-list">
              {items.map((item) => (
                <div className="file-operation-row" key={item.id}>
                  <span className={item.action === "delete" ? "danger" : ""}>
                    {labels[item.action] || item.action}
                  </span>
                  <div>
                    <strong title={item.path}>{item.path}</strong>
                    <small>
                      {item.detail}
                      {item.action === "delete" && item.restored
                        ? " · 已恢复"
                        : ""}
                    </small>
                  </div>
                  <time>
                    {new Date(item.created_at).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </time>
                  {item.canRestore && (
                    <Button
                      size="mini"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !(await confirm(
                            "恢复文件",
                            `将 ${item.path} 恢复到原位置。已有同名文件时不会覆盖。`,
                          ))
                        )
                          return;
                        run(async () => {
                          const result = await post(
                            `/api/local/${id}/restore-file`,
                            { operationId: item.id },
                          );
                          resource.reload();
                          await onRestore(result.path);
                          Message.success("文件已恢复");
                        });
                      }}
                    >
                      恢复
                    </Button>
                  )}
                </div>
              ))}
              {more && (
                <Button
                  size="small"
                  loading={busy}
                  onClick={() =>
                    run(async () => {
                      const next = await get(
                        `/api/local/${id}/file-operations?before=${items[items.length - 1].id}`,
                      );
                      setExtra((previous) => [...previous, ...next.items]);
                      setMore(next.hasMore);
                    })
                  }
                >
                  加载更早的记录
                </Button>
              )}
            </div>
          ) : (
            <div className="empty">暂无文件操作记录</div>
          )
        }
      </Resource>
    </Modal>
  );
}
