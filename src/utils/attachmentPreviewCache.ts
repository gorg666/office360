/**
 * Session cache for attachment preview data URLs.
 * Avoids re-fetching the same attachment on every remount/render.
 */

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

export function attachmentPreviewCacheKey(
  accountId: string,
  messageId: string,
  attachmentId: string,
): string {
  return `${accountId}:${messageId}:${attachmentId}`;
}

export function getCachedAttachmentPreview(key: string): string | undefined {
  return cache.get(key);
}

export function setCachedAttachmentPreview(key: string, dataUrl: string): void {
  cache.set(key, dataUrl);
}

export function getOrCreateAttachmentPreviewLoad(
  key: string,
  loader: () => Promise<string>,
): Promise<string> {
  const existing = cache.get(key);
  if (existing) return Promise.resolve(existing);

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = loader()
    .then((url) => {
      cache.set(key, url);
      inflight.delete(key);
      return url;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

/** Test helper */
export function clearAttachmentPreviewCache(): void {
  cache.clear();
  inflight.clear();
}
