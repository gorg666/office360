export interface OAuthProviderConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Public desktop/native client ID. Safe to ship; secret is not used with PKCE. */
  publicClientId?: string;
  userInfoUrl?: string;
  userInfoAuthScheme?: "Bearer" | "OAuth";
  /** Whether PKCE is required (Microsoft requires it, Yahoo supports it) */
  usePkce: boolean;
}

const DEFAULT_YANDEX_SCOPES = [
  "login:email",
  "login:info",
  "login:avatar",
  "mail:imap_full",
  "mail:smtp",
  "calendar:all",
];
const DEFAULT_YANDEX_PUBLIC_CLIENT_ID = "cdab208ec00f4cbc9c7a453ae6455983";
const ENV_YANDEX_PUBLIC_CLIENT_ID = import.meta.env.VITE_YANDEX_OAUTH_CLIENT_ID?.trim() ?? "";
const YANDEX_PUBLIC_CLIENT_ID =
  ENV_YANDEX_PUBLIC_CLIENT_ID || DEFAULT_YANDEX_PUBLIC_CLIENT_ID;
const YANDEX_SCOPES = import.meta.env.VITE_YANDEX_OAUTH_SCOPES
  ? import.meta.env.VITE_YANDEX_OAUTH_SCOPES.split(/[,\s]+/)
    .map((scope: string) => scope.trim())
    .filter(Boolean)
  : DEFAULT_YANDEX_SCOPES;

export function getYandexOAuthConfigDiagnostics() {
  return {
    envClientId: ENV_YANDEX_PUBLIC_CLIENT_ID || null,
    fallbackClientId: DEFAULT_YANDEX_PUBLIC_CLIENT_ID,
    effectiveClientId: YANDEX_PUBLIC_CLIENT_ID,
    clientIdSource: ENV_YANDEX_PUBLIC_CLIENT_ID ? "env:VITE_YANDEX_OAUTH_CLIENT_ID" : "fallback:DEFAULT_YANDEX_PUBLIC_CLIENT_ID",
    envScopesRaw: import.meta.env.VITE_YANDEX_OAUTH_SCOPES?.trim() || null,
    effectiveScopes: [...YANDEX_SCOPES],
  };
}

const providers: Record<string, OAuthProviderConfig> = {
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authUrl:
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    tokenUrl:
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    scopes: [
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "profile",
      "email",
    ],
    userInfoUrl: undefined,
    usePkce: true,
  },
  yahoo: {
    id: "yahoo",
    name: "Yahoo",
    authUrl: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
    scopes: ["mail-r", "mail-w", "openid", "sdps-r"],
    userInfoUrl: "https://api.login.yahoo.com/openid/v1/userinfo",
    usePkce: true,
  },
  yandex: {
    id: "yandex",
    name: "Яндекс ID",
    authUrl: "https://oauth.yandex.ru/authorize",
    tokenUrl: "https://oauth.yandex.ru/token",
    scopes: YANDEX_SCOPES,
    publicClientId: YANDEX_PUBLIC_CLIENT_ID,
    userInfoUrl: "https://login.yandex.ru/info?format=json",
    userInfoAuthScheme: "OAuth",
    usePkce: true,
  },
};

export function getOAuthProvider(id: string): OAuthProviderConfig | null {
  return providers[id] ?? null;
}

export function getAllOAuthProviders(): OAuthProviderConfig[] {
  return Object.values(providers);
}
