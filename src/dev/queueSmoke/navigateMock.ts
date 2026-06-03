export function navigateBack(): void {
  window.history.back();
}

export function navigateBackFromRepair(): void {
  window.history.back();
}

export function navigateBackFromSettings(): void {
  window.history.back();
}

export function navigateToLabel(label: string): void {
  window.dispatchEvent(new CustomEvent("queue-smoke-navigation", { detail: label }));
}

export function navigateToSettings(tab = "general"): void {
  window.dispatchEvent(new CustomEvent("queue-smoke-navigation", { detail: `settings:${tab}` }));
}

export function navigateToRepairCenter(accountId?: string): void {
  window.dispatchEvent(new CustomEvent("queue-smoke-navigation", { detail: accountId ? `repair:${accountId}` : "repair" }));
}

export function navigateToQueueInspector(): void {
  window.dispatchEvent(new CustomEvent("queue-smoke-navigation", { detail: "queue" }));
}

export function navigateToHelp(topic = "getting-started"): void {
  window.dispatchEvent(new CustomEvent("queue-smoke-navigation", { detail: `help:${topic}` }));
}

export function navigateToThread(threadId: string): void {
  window.dispatchEvent(new CustomEvent("queue-smoke-navigation", { detail: `thread:${threadId}` }));
}

export function navigateToInboxFallback(): void {
  window.dispatchEvent(new CustomEvent("queue-smoke-navigation", { detail: "inbox" }));
}

export function getSelectedThreadId(): string | null {
  return null;
}

export function getActiveLabel(): string {
  return "inbox";
}

export function captureSettingsReturnLocation(): void {}
