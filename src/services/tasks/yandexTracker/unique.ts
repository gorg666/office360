/**
 * Tracker `unique` idempotency keys for Office360 Tasks.
 * Format: office360:v1:<org>:<source/client identity>
 */
export function buildTaskUniqueKey(parts: {
  organizationId: string;
  sourceIdentity: string;
}): string {
  const org = parts.organizationId.trim();
  const identity = parts.sourceIdentity.trim();
  if (!org || !identity) {
    throw new Error("unique key requires organizationId and sourceIdentity");
  }
  return `office360:v1:${org}:${identity}`;
}

export function buildMailTaskUniqueKey(parts: {
  organizationId: string;
  accountId: string;
  messageId: string;
  clientTaskId: string;
}): string {
  return buildTaskUniqueKey({
    organizationId: parts.organizationId,
    sourceIdentity: `mail:${parts.accountId}:${parts.messageId}:${parts.clientTaskId}`,
  });
}
