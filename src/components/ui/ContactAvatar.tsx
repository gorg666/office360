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

interface ContactAvatarProps {
  email: string | null | undefined;
  name?: string | null;
  className: string;
  textClassName?: string;
  fallbackClassName?: string;
  showDomainFallback?: boolean;
}

export function ContactAvatar({
  email,
  name,
  className,
  textClassName = "",
  fallbackClassName = "bg-accent/20 text-accent",
  showDomainFallback = true,
}: ContactAvatarProps) {
  const accounts = useAccountStore((state) => state.accounts);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const display = name || email || "Unknown";
  const initial = (display[0] ?? "?").toUpperCase();

  const accountAvatarUrl = useMemo(() => {
    if (!email) return null;
    const normalized = normalizeEmail(email);
    return accounts.find((account) => normalizeEmail(account.email) === normalized)?.avatarUrl ?? null;
  }, [accounts, email]);

  const domainFallbackUrl = useMemo(() => {
    if (!showDomainFallback || !email) return null;
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || CONSUMER_EMAIL_DOMAINS.has(domain)) return null;
    // DuckDuckGo returns 404 when it has no favicon, so onError falls back to initials
    // instead of showing Google's generic globe placeholder.
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
  }, [email, showDomainFallback]);

  useEffect(() => {
    let cancelled = false;
    setAvatarUrl(null);
    setImageFailed(false);

    if (!email) return () => { cancelled = true; };
    if (accountAvatarUrl) {
      setAvatarUrl(accountAvatarUrl);
      return () => { cancelled = true; };
    }

    loadAvatar(email).then((url) => {
      if (cancelled) return;
      setAvatarUrl(url ?? domainFallbackUrl);
    });

    return () => { cancelled = true; };
  }, [email, accountAvatarUrl, domainFallbackUrl]);

  if (avatarUrl && !imageFailed) {
    return (
      <img
        src={avatarUrl}
        alt={display}
        className={`${className} object-cover`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className={`${className} ${fallbackClassName} flex items-center justify-center font-medium ${textClassName}`}>
      {initial}
    </div>
  );
}
