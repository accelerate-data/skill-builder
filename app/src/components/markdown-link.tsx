import type { Components } from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Custom ReactMarkdown `components` that open links in the system browser
 * instead of navigating the Tauri webview (which would crash the SPA).
 *
 * Usage:
 *   <ReactMarkdown components={markdownComponents} ...>
 */
export const markdownComponents: Components = {
  a({ href, children }) {
    if (!href) return <>{children}</>;
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          openUrl(href);
        }}
        className="cursor-pointer"
      >
        {children}
      </a>
    );
  },
};
