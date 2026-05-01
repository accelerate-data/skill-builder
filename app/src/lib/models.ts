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
