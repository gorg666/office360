export function resolveYandexGrantedScopeValue(
  reportedScopes: string | undefined,
  requestedScopes: readonly string[],
): string {
  return reportedScopes?.trim() || requestedScopes.join(" ");
}

export function parseOAuthScopes(scopeValue: string | null | undefined): Set<string> {
  if (!scopeValue) return new Set();
  return new Set(scopeValue.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean));
}
