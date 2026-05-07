export interface OAuthProviderConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  userInfoUrl?: string;
  userInfoAuthScheme?: "Bearer" | "OAuth";
  /** Whether PKCE is required (Microsoft requires it, Yahoo supports it) */
  usePkce: boolean;
}

const yandexMailScopes = ["mail:imap_full", "mail:smtp", "login:email", "login:info"];

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
    scopes: yandexMailScopes,
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
