import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Message, Modal } from "./ui-kit";
import { get, report } from "./api";

export function useResource(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: "" }));
    Promise.resolve()
      .then(() => loader(controller.signal))
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ data: null, loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [...deps, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function run(fn) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (error) {
      report(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return [busy, run];
}
export function LoadingState({ label = "正在读取…" }) {
  return (
    <div className="resource-loading" role="status" aria-busy="true">
      <div className="resource-loading-lines" aria-hidden="true"><i /><i /><i /></div>
      <span>{label}</span>
    </div>
  );
}

export function Resource({ resource, children, empty = "暂无内容" }) {
  if (resource.loading && resource.data === null) return <LoadingState />;
  if (resource.error)
    return (
      <Alert
        type="error"
        content={resource.error}
        action={
          <Button size="mini" onClick={resource.reload}>
            重试
          </Button>
        }
      />
    );
  return <>
    {resource.loading && <div className="resource-refresh" role="status" aria-label="正在刷新" />}
    {children(resource.data) || <div className="empty">{empty}</div>}
  </>;
}
export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function FolderInput({ value, onChange, ...props }) {
  const [busy, run] = useAction();
  return (
    <Input
      {...props}
      value={value}
      onChange={onChange}
      addAfter={
        <Button
          loading={busy}
          size="small"
          onClick={() =>
            run(async () => {
              const result = await get("/api/pick-folder");
              if (result.error) throw new Error(result.error);
              if (result.path) onChange(result.path);
            })
          }
        >
          浏览
        </Button>
      }
    />
  );
}
export function FormModal({
  title,
  onClose,
  onSubmit,
  children,
  okText = "保存",
  width = 540,
  canSubmit = true,
  formRef,
}) {
  const [busy, run] = useAction();
  return (
    <Modal
      visible
      title={title}
      style={{ width, maxWidth: "calc(100vw - 24px)" }}
      maskClosable={!busy}
      closable={!busy}
      onCancel={() => !busy && onClose()}
      footer={null}
      unmountOnExit
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit || busy) return;
          run(onSubmit);
        }}
      >
        <fieldset disabled={busy}>{children}</fieldset>
        <div className="dialog-footer">
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            htmlType="submit"
            type="primary"
            loading={busy}
            disabled={!canSubmit}
          >
            {okText}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function Diff({ resource, title, onClose }) {
  return (
    <Modal
      visible
      title={title}
      footer={null}
      onCancel={onClose}
      style={{ width: 960, maxWidth: "calc(100vw - 24px)" }}
    >
      <Resource resource={resource}>
        {(data) => (
          <div className="diff-body">
            {(data.binary
              ? "二进制文件，无法展示文本差异"
              : data.text || "没有差异"
            )
              .split("\n")
              .map((line, i) => (
                <div
                  key={i}
                  className={`diff-line ${line.startsWith("+++") || line.startsWith("---") ? "meta" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : ""}`}
                >
                  <span className="line-number">{i + 1}</span>
                  <span>{line || " "}</span>
                </div>
              ))}
          </div>
        )}
      </Resource>
    </Modal>
  );
}
export function ResultSummary({ result }) {
  return (
    <div className="result-summary">
      {result.results?.map((item, i) => (
        <div key={item.id || i} className={item.ok ? "success" : "danger"}>
          {item.ok ? "✓" : "✕"} {item.name} {item.error || "完成"}
        </div>
      ))}
    </div>
  );
}
