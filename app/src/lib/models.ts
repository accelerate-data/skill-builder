export function requireSettingsModel(model?: string | null): string {
  const selected = model?.trim();
  if (!selected) {
    throw new Error("Select a model in Settings before running agents.");
  }
  return selected;
}

export function formatProviderModelId(model: string): string {
  return model
    .split("-")
    .filter(Boolean)
    .map((part) =>
      /^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

export function isLocalModelBaseUrl(baseUrl?: string | null): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const url = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function modelSettingsRequireApiKey(
  provider?: string | null,
  model?: string | null,
  baseUrl?: string | null,
): boolean {
  const normalizedProvider = provider?.trim().toLowerCase() || "";
  return (
    normalizedProvider !== "ollama" &&
    !model?.trim().startsWith("ollama/") &&
    !isLocalModelBaseUrl(baseUrl)
  );
}
