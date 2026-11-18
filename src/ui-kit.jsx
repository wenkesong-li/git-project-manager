// 无视觉框架依赖的基础控件；Radix 仅处理焦点、键盘和无障碍行为。
import React, { forwardRef, useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  Search,
  X,
  CircleAlert,
} from "lucide-react";
import { toast } from "sonner";

export const Message = {
  success: (text) => toast.success(text),
  error: (text) => toast.error(text),
  warning: (text) => toast.warning(text),
  info: (text) => toast.info(text),
};
export const Button = forwardRef(function Button(
  {
    children,
    type,
    htmlType = "button",
    status,
    size,
    icon,
    loading,
    disabled,
    className = "",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={htmlType}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`ui-btn ${type === "primary" ? "ui-btn-primary" : ""} ${status === "danger" ? "ui-btn-danger" : ""} ${size ? `ui-btn-${size}` : ""} ${className}`}
    >
      {loading ? <LoaderCircle className="ui-spinner" size={14} /> : icon}
      {children}
    </button>
  );
});
export const Input = forwardRef(function Input(
  {
    value = "",
    onChange,
    prefix,
    addAfter,
    allowClear,
    autoSize,
    onPressEnter,
    onSearch,
    placeholder,
    size,
    className = "",
    type = "text",
    ...props
  },
  ref,
) {
  return (
    <span className={`ui-input-group ${className}`}>
      <span className="ui-input-wrapper">
        {prefix}
        <input
          {...props}
          ref={ref}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
            if (event.key === "Enter") {
              onPressEnter?.(event);
              if (onSearch) {
                event.preventDefault();
                onSearch(value);
              }
            }
          }}
        />
        {allowClear && value && (
          <button
            type="button"
            aria-label="清除输入"
            className="text-button"
            onClick={() => onChange?.("")}
          >
            <X size={13} />
          </button>
        )}
      </span>
      {addAfter}
    </span>
  );
});
Input.Search = forwardRef(function SearchInput(
  { onSearch, value, ...props },
  ref,
) {
  return (
    <Input
      {...props}
      ref={ref}
      value={value}
      onSearch={onSearch}
      prefix={<Search size={14} />}
      addAfter={<Button onClick={() => onSearch?.(value)}>搜索</Button>}
    />
  );
});
Input.Password = function PasswordInput(props) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      addAfter={
        <Button
          aria-label={visible ? "隐藏密码" : "显示密码"}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </Button>
      }
    />
  );
};
Input.TextArea = function TextArea({
  value = "",
  onChange,
  autoSize,
  showWordLimit,
  className = "",
  ...props
}) {
  const input = useRef(null);
  useEffect(() => {
    if (input.current && autoSize) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, (autoSize.maxRows || 26) * 22)}px`;
    }
  }, [value, autoSize?.maxRows]);
  return (
    <div className={`ui-textarea ${className}`}>
      <textarea
        {...props}
        ref={input}
        rows={autoSize?.minRows || 4}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {showWordLimit && (
        <small>
          {value.length}
          {props.maxLength ? ` / ${props.maxLength}` : ""}
        </small>
      )}
    </div>
  );
};
export function Select({
  value,
  onChange,
  options = [],
  placeholder = "请选择",
  disabled,
  loading,
  showSearch,
  allowCreate,
  allowClear,
  onVisibleChange,
  size,
  style,
  className = "",
  ...props
}) {
  const id = useId();
  const normalized = options.map((option) =>
    typeof option === "object" ? option : { value: option, label: option },
  );
  return (
    <span className={`ui-select ${className}`} style={style}>
      {showSearch || allowCreate ? (
        <>
          <input
            {...props}
            className="ui-select-view"
            list={id}
            value={value ?? ""}
            placeholder={placeholder}
            disabled={disabled}
            onFocus={() => onVisibleChange?.(true)}
            onChange={(event) => onChange?.(event.target.value)}
          />
          <datalist id={id}>
            {normalized.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
        </>
      ) : (
        <select
          {...props}
          className="ui-select-view"
          value={value ?? ""}
          disabled={disabled}
          onFocus={() => onVisibleChange?.(true)}
          onChange={(event) => {
            const item = normalized.find(
              (option) => String(option.value) === event.target.value,
            );
            onChange?.(item?.value ?? event.target.value);
          }}
        >
          {(value === undefined || value === "") && (
            <option value="" disabled={!allowClear}>
              {placeholder}
            </option>
          )}
          {normalized.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      )}
      {loading ? (
        <LoaderCircle size={13} className="ui-select-arrow ui-spinner" />
      ) : (
        <ChevronDown size={13} className="ui-select-arrow" />
      )}
    </span>
  );
}
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  children,
  ...props
}) {
  const input = useRef(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="ui-checkbox">
      <input
        {...props}
        ref={input}
        type="checkbox"
        checked={!!checked}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="ui-checkbox-box" aria-hidden="true" />
      {children && <span>{children}</span>}
    </label>
  );
}
export function Tag({ color, children }) {
  return (
    <span className="ui-tag" data-color={color}>
      {children}
    </span>
  );
}
export function Spin() {
  return (
    <span className="ui-spin" role="status" aria-label="正在加载">
      <LoaderCircle size={22} className="ui-spinner" />
    </span>
  );
}
export function Alert({ type = "info", content, action }) {
  return (
    <div
      className={`ui-alert ui-alert-${type}`}
      role={type === "error" ? "alert" : "status"}
    >
      <CircleAlert size={16} />
      <div>{content}</div>
      {action}
    </div>
  );
}
export function Modal({
  visible,
  title,
  children,
  footer,
  onCancel,
  style,
  maskClosable = true,
  closable = true,
  ...ignored
}) {
  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(open) => {
        if (!open && closable) onCancel?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-modal-mask" />
        <Dialog.Content
          className="ui-modal"
          style={style}
          data-ui-modal="true"
          aria-describedby={undefined}
          onPointerDownOutside={(event) => {
            if (!maskClosable || !closable) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (!closable) event.preventDefault();
          }}
        >
          <div className="ui-modal-header">
            <Dialog.Title className="ui-modal-title">{title}</Dialog.Title>
            {closable && (
              <Dialog.Close asChild>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="关闭弹窗"
                >
                  <X size={17} />
                </button>
              </Dialog.Close>
            )}
          </div>
          <div className="ui-modal-content">{children}</div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function openModal(options, isConfirm) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let closed = false;
  function close(action) {
    if (closed) return;
    closed = true;
    root.unmount();
    container.remove();
    action?.();
  }
  root.render(
    <Modal
      visible
      title={options.title}
      style={options.style}
      onCancel={() => close(options.onCancel)}
      footer={
        <>
          <Button onClick={() => close(options.onCancel)}>
            {isConfirm ? options.cancelText || "取消" : "关闭"}
          </Button>
          {isConfirm && (
            <Button
              type="primary"
              status={options.okButtonProps?.status}
              onClick={() => close(options.onOk)}
            >
              {options.okText || "确定"}
            </Button>
          )}
        </>
      }
    >
      {options.content}
    </Modal>,
  );
  return { destroy: () => close(options.onCancel) };
}
Modal.confirm = (options) => openModal(options, true);
Modal.info = (options) => openModal(options, false);
export function Popover({ children, title, content }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="ui-popover"
          side="bottom"
          align="end"
          sideOffset={10}
          aria-label={title}
        >
          <div className="ui-popover-title">{title}</div>
          {content}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
export function Tabs({ activeTab, onChange, children }) {
  const panes = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) panes.push(child);
  });
  return (
    <TabsPrimitive.Root
      value={activeTab}
      onValueChange={onChange}
      className="ui-tabs"
    >
      <TabsPrimitive.List className="ui-tabs-list" aria-label="仓库功能">
        {panes.map((pane) => (
          <TabsPrimitive.Trigger
            key={pane.key}
            value={String(pane.key)}
            className="ui-tab"
          >
            {pane.props.title}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {panes.map((pane) => (
        <TabsPrimitive.Content
          key={pane.key}
          value={String(pane.key)}
          className="ui-tab-panel"
          forceMount={pane.props.keepAlive || undefined}
        >
          {pane.props.children}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
Tabs.TabPane = function TabPane() {
  return null;
};
