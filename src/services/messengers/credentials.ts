export type MessengerProviderId = "max" | "yandex" | "telegram";

export interface MessengerCredentials {
  providerId: MessengerProviderId;
  token: string;
  savedAt: number;
}

export interface MessengerTarget {
  id: string;
  providerId: MessengerProviderId;
  kind: "chat" | "user" | "login";
  title: string;
  subtitle?: string;
  updatedAt: number;
}

const CREDENTIALS_KEY = "velo_messenger_bot_credentials:v1";
const TARGETS_KEY = "velo_messenger_targets:v1";

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadMessengerCredentials(providerId: MessengerProviderId): MessengerCredentials | null {
  const credentials = readArray<MessengerCredentials>(CREDENTIALS_KEY);
  return credentials.find((item) => item.providerId === providerId && typeof item.token === "string") ?? null;
}

export function saveMessengerCredentials(providerId: MessengerProviderId, token: string): MessengerCredentials {
  const credential: MessengerCredentials = {
    providerId,
    token: token.trim(),
    savedAt: Date.now(),
  };
  const next = [
    credential,
    ...readArray<MessengerCredentials>(CREDENTIALS_KEY).filter((item) => item.providerId !== providerId),
  ];
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(next));
  return credential;
}

export function clearMessengerCredentials(providerId: MessengerProviderId): void {
  const next = readArray<MessengerCredentials>(CREDENTIALS_KEY).filter((item) => item.providerId !== providerId);
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(next));
}

export function maskMessengerToken(token: string): string {
  if (token.length <= 12) return "********";
  return `${token.slice(0, 5)}...${token.slice(-5)}`;
}

export function loadMessengerTargets(providerId: MessengerProviderId): MessengerTarget[] {
  return readArray<MessengerTarget>(TARGETS_KEY)
    .filter((target) => target.providerId === providerId && typeof target.id === "string")
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveMessengerTarget(target: Omit<MessengerTarget, "updatedAt">): MessengerTarget[] {
  const nextTarget: MessengerTarget = { ...target, updatedAt: Date.now() };
  const next = [
    nextTarget,
    ...readArray<MessengerTarget>(TARGETS_KEY).filter(
      (item) => !(item.providerId === target.providerId && item.kind === target.kind && item.id === target.id),
    ),
  ].slice(0, 50);
  localStorage.setItem(TARGETS_KEY, JSON.stringify(next));
  return next.filter((item) => item.providerId === target.providerId);
}
