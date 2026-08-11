/** Max OAuth access-token TTL we will persist (400 days). */
const MAX_TTL_SECONDS = 400 * 24 * 60 * 60;

/**
 * Convert provider `expires_in` into an absolute unix expiry (seconds).
 *
 * Yandex documents `expires_in` as lifetime in seconds. Doc examples sometimes
 * show absurd magnitudes — those are clamped. Absolute unix timestamps
 * (seconds or ms) are accepted only when they fall near "now".
 */
export function computeTokenExpiresAtSeconds(
  expiresIn: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): number {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return nowSec + 3600;
  }

  const looksNearNow = (absSec: number) =>
    absSec > nowSec - 86_400 && absSec < nowSec + MAX_TTL_SECONDS * 2;

  // Absolute unix milliseconds (~13 digits).
  if (expiresIn >= 1_000_000_000_000) {
    const asSec = Math.floor(expiresIn / 1000);
    return looksNearNow(asSec) ? asSec : nowSec + MAX_TTL_SECONDS;
  }

  // Absolute unix seconds (~10 digits, current era).
  if (expiresIn >= 1_000_000_000) {
    const abs = Math.floor(expiresIn);
    return looksNearNow(abs) ? abs : nowSec + MAX_TTL_SECONDS;
  }

  return nowSec + Math.min(Math.floor(expiresIn), MAX_TTL_SECONDS);
}
