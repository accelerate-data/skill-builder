import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { attachConsole } from "@tauri-apps/plugin-log";
import { ThemeProvider } from "./components/theme-provider";
import { ErrorBoundary } from "./components/error-boundary";
import { Toaster } from "./components/ui/sonner";
import { logFrontend } from "./lib/tauri";
import { router } from "./router";
import { appQueryClient } from "./lib/query-client";
import '@fontsource-variable/jetbrains-mono';
import "github-markdown-css/github-markdown.css";
import "./styles/globals.css";

// Mirror Rust log entries into the webview console (useful in dev).
// Note: this is backend → console, not console → backend persistence.
attachConsole().catch((err) => {
  console.error('Failed to attach console logger:', err);
});

window.addEventListener("error", (event) => {
  const details = [
    event.message,
    event.filename ? `file=${event.filename}` : null,
    event.lineno ? `line=${event.lineno}` : null,
    event.colno ? `col=${event.colno}` : null,
    event.error instanceof Error && event.error.stack
      ? `stack=${event.error.stack}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  void logFrontend("error", `[window.error] ${details}`);
});

window.addEventListener("unhandledrejection", (event) => {
  let reason = "unknown";
  if (event.reason instanceof Error) {
    reason = event.reason.stack ?? event.reason.message;
  } else if (typeof event.reason === "string") {
    reason = event.reason;
  } else if (event.reason != null) {
    try {
      reason = JSON.stringify(event.reason);
    } catch {
      reason = String(event.reason);
    }
  }
  void logFrontend("error", `[window.unhandledrejection] ${reason}`);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={appQueryClient}>
      <ThemeProvider>
        <ErrorBoundary>
          <RouterProvider router={router} />
          <Toaster position="top-right" offset={{ top: 40, right: 12 }} />
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
