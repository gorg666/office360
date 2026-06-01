/**
 * OAuth 2.0 Client IDs from Google Cloud look like:
 * PROJECT_NUMBER-RANDOM.apps.googleusercontent.com
 */
const GOOGLE_OAUTH_CLIENT_ID_RE =
  /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;

export function isValidGoogleOAuthClientIdFormat(clientId: string): boolean {
  const trimmed = clientId.trim();
  if (!trimmed) return false;
  return GOOGLE_OAUTH_CLIENT_ID_RE.test(trimmed);
}
