import { useEffect, useMemo, useState } from "react";
import { fetchAndCacheGravatarUrl } from "@/services/contacts/gravatar";
import { useAccountStore } from "@/stores/accountStore";
import { normalizeEmail } from "@/utils/emailUtils";

const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);

const KNOWN_BRAND_DOMAINS = [
  "yandex.ru",
  "yandex.com",
  "microsoft.com",
  "office.com",
  "tbank.ru",
  "kontur.ru",
  "diadoc.ru",
  "kaiten.ru",
  "innopolis.ru",
];

const avatarRequestCache = new Map<string, Promise<string | null>>();
const AVATAR_MISS_TTL_MS = 60_000;

function loadAvatar(email: string): Promise<string | null> {
  const key = email.trim().toLowerCase();
  const existing = avatarRequestCache.get(key);
  if (existing) return existing;

  const request = fetchAndCacheGravatarUrl(email).then((url) => {
    if (!url) {
      window.setTimeout(() => avatarRequestCache.delete(key), AVATAR_MISS_TTL_MS);
    }
    return url;
  });
  avatarRequestCache.set(key, request);
  return request;
}

function getDomainForIcon(email: string): string | null {
  const rawDomain = email.split("@")[1]?.trim().toLowerCase();
  if (!rawDomain) return null;

  for (const brandDomain of KNOWN_BRAND_DOMAINS) {
    if (rawDomain === brandDomain || rawDomain.endsWith(`.${brandDomain}`)) {
      return brandDomain;
    }
  }

  const parts = rawDomain.split(".").filter(Boolean);
  if (parts.length <= 2) return rawDomain;

  const suffix = parts.slice(-2).join(".");
  if (CONSUMER_EMAIL_DOMAINS.has(suffix)) return suffix;
  return suffix;
}

function uniqueUrls(urls: (string | null)[]): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

interface ContactAvatarProps {
  email: string | null | undefined;
  name?: string | null;
  className: string;
  textClassName?: string;
  fallbackClassName?: string;
  avatarUrl?: string | null;
  showDomainFallback?: boolean;
  lookupExternalAvatar?: boolean;
}

export function ContactAvatar({
  email,
  name,
  className,
  textClassName = "",
  fallbackClassName = "bg-accent/20 text-accent",
  avatarUrl,
  showDomainFallback = true,
  lookupExternalAvatar = true,
}: ContactAvatarProps) {
  const accounts = useAccountStore((state) => state.accounts);
  const [avatarCandidates, setAvatarCandidates] = useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const display = name || email || "Unknown";
  const initial = (display[0] ?? "?").toUpperCase();

  const accountAvatarUrl = useMemo(() => {
    if (avatarUrl !== undefined) return avatarUrl;
    if (!email) return null;
    const normalized = normalizeEmail(email);
    return accounts.find((account) => normalizeEmail(account.email) === normalized)?.avatarUrl ?? null;
  }, [accounts, avatarUrl, email]);

  const domainFallbackUrl = useMemo(() => {
    if (!showDomainFallback || !email) return null;
    const domain = getDomainForIcon(email);
    if (!domain) return null;
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
  }, [email, showDomainFallback]);

  useEffect(() => {
    let cancelled = false;
    const initialCandidates = uniqueUrls([accountAvatarUrl, domainFallbackUrl]);
    setAvatarCandidates(initialCandidates);
    setCandidateIndex(0);

    if (!email || !lookupExternalAvatar) return () => { cancelled = true; };

    loadAvatar(email).then((url) => {
      if (cancelled) return;
      setAvatarCandidates(uniqueUrls([accountAvatarUrl, url, domainFallbackUrl]));
      setCandidateIndex(0);
    });

    return () => { cancelled = true; };
  }, [email, accountAvatarUrl, domainFallbackUrl, lookupExternalAvatar]);

  const currentAvatarUrl = avatarCandidates[candidateIndex] ?? null;

  if (currentAvatarUrl) {
    return (
      <img
        src={currentAvatarUrl}
        alt={display}
        className={`${className} object-cover`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setCandidateIndex((idx) => idx + 1)}
      />
    );
  }

  return (
    <div className={`${className} ${fallbackClassName} flex items-center justify-center font-medium ${textClassName}`}>
      {initial}
    </div>
  );
}
