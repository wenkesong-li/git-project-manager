import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "./style.css";
import App from "./App";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h1>页面遇到了问题</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("app")).render(
  <ErrorBoundary>
    <App />
    <Toaster
      position="bottom-right"
      closeButton
      toastOptions={{
        style: {
          background: "var(--surface)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
        },
      }}
    />
  </ErrorBoundary>,
);
