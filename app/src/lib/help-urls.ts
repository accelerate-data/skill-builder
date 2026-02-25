const BASE = "https://hbanerjee74.github.io/skill-builder";

export const HELP_URLS: Record<string, string> = {
  "/":         `${BASE}/`,
  "/refine":   `${BASE}/refine`,
  "/test":     `${BASE}/test`,
  "/settings": `${BASE}/settings`,
  "/usage":    `${BASE}/usage`,
  "/skill":    `${BASE}/workflow/overview`,
};

export function getHelpUrl(path: string): string {
  if (path.startsWith("/skill/")) return HELP_URLS["/skill"];
  return HELP_URLS[path] ?? `${BASE}/`;
}
