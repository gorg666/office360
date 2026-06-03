export function startQueueProcessor(): void {}

export function stopQueueProcessor(): void {}

export async function triggerQueueFlush(): Promise<void> {
  window.dispatchEvent(new Event("velo-queue-changed"));
  window.dispatchEvent(new Event("velo-outbox-changed"));
  window.dispatchEvent(new Event("velo-sync-health-changed"));
}
