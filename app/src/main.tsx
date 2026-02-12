import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { attachConsole } from "@tauri-apps/plugin-log";
import { ThemeProvider } from "./components/theme-provider";
import { ErrorBoundary } from "./components/error-boundary";
import { Toaster } from "./components/ui/sonner";
import { router } from "./router";
import "github-markdown-css/github-markdown.css";
import "./styles/globals.css";

// Route console.log/warn/error to the Rust log backend (writes to log file)
attachConsole().catch((err) => {
  console.error('Failed to attach console logger:', err);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <RouterProvider router={router} />
        <Toaster />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
