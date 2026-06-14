import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
  Mail,
  Send,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  getAccountByEmail,
  insertImapAccount,
  insertOAuthImapAccount,
  updateOAuthImapAccount,
} from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";
import {
  discoverSettings,
  getDefaultImapPort,
  getDefaultSmtpPort,
  type SecurityType,
} from "@/services/imap/autoDiscovery";
import { getOAuthProvider } from "@/services/oauth/providers";
import { getYandexOAuthConfigDiagnostics } from "@/services/oauth/providers";
import { startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
import { getSetting } from "@/services/db/settings";
import { createConnectionDiagnostic, type ConnectionDiagnostic } from "@/services/diagnostics";

interface AddImapAccountProps {
  onClose: () => void;
  onSuccess: (accountId: string) => void;
  onBack: () => void;
  oauthPreset?: {
    providerId: string;
    title: string;
    defaultEmail: string;
    description: string;
  };
}

type Step = "basic" | "imap" | "smtp" | "test";
type AuthMode = "password" | "oauth2";

interface FormState {
  email: string;
  displayName: string;
  imapUsername: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: SecurityType;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SecurityType;
  password: string;
  smtpPassword: string;
  samePassword: boolean;
  acceptInvalidCerts: boolean;
  // OAuth2 fields
  authMode: AuthMode;
  oauthProvider: string | null;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthExpiresAt: number | null;
  oauthEmail: string | null;
  oauthPicture: string | null;
  /** Space/comma-separated scopes from token response (never logged in full). */
  oauthGrantedScopes: string | null;
}

const initialFormState: FormState = {
  email: "",
  displayName: "",
  imapUsername: "",
  imapHost: "",
  imapPort: 993,
  imapSecurity: "ssl",
  smtpHost: "",
  smtpPort: 465,
  smtpSecurity: "ssl",
  password: "",
  smtpPassword: "",
  samePassword: true,
  acceptInvalidCerts: false,
  authMode: "password",
  oauthProvider: null,
  oauthClientId: "",
  oauthClientSecret: "",
  oauthAccessToken: null,
  oauthRefreshToken: null,
  oauthExpiresAt: null,
  oauthEmail: null,
  oauthPicture: null,
  oauthGrantedScopes: null,
};

const steps: Step[] = ["basic", "imap", "smtp", "test"];
const managedOAuthSteps: Step[] = ["basic"];

const stepLabels: Record<Step, string> = {
  basic: "Account",
  imap: "Incoming",
  smtp: "Outgoing",
  test: "Verify",
};

const stepIcons: Record<Step, React.ReactNode> = {
  basic: <Mail className="w-4 h-4" />,
  imap: <Server className="w-4 h-4" />,
  smtp: <Send className="w-4 h-4" />,
  test: <ShieldCheck className="w-4 h-4" />,
};

interface TestStatus {
  state: "idle" | "testing" | "success" | "error";
  message?: string;
  diagnostic?: ConnectionDiagnostic;
}

const inputClass =
  "w-full px-3 py-2 bg-bg-secondary border border-border-primary rounded-lg text-sm text-text-primary outline-none focus:border-accent transition-colors";
const labelClass = "block text-xs font-medium text-text-secondary mb-1";
const selectClass =
  "w-full px-3 py-2 bg-bg-secondary border border-border-primary rounded-lg text-sm text-text-primary outline-none focus:border-accent transition-colors appearance-none";
const IMAP_TEST_TIMEOUT_MS = 35_000;
/** UI + belt-and-suspenders around hung lettre `test_connection` (Rust also enforces ~20s). */
const SMTP_TEST_TIMEOUT_MS = 20_000;
const REQUIRED_YANDEX_MAIL_SCOPES = ["mail:imap_full", "mail:smtp"];

const SMTP_SCOPE_MISSING =
  "This token does not include SMTP access. Use an app password or sign in again with the required permissions.";

const SMTP_YANDEX_APP_PASSWORD_HINT =
  "For Yandex Mail you may need an app password. Enable app passwords in Yandex ID security settings and use it instead of your account password.";

const YANDEX_MAIL_SCOPES_MISSING_TITLE =
  "Yandex ID connected, but mail permissions are missing.";
const YANDEX_MAIL_SCOPES_REQUIRED =
  "Mail permissions are required to sync and send email.";
const YANDEX_MAIL_SCOPES_MISSING_BODY =
  "Sign in again with mail access enabled, or use an app password with manual IMAP/SMTP setup.";

function hasYandexMailScopes(scopes: Set<string>): boolean {
  return REQUIRED_YANDEX_MAIL_SCOPES.every((scope) => scopes.has(scope));
}

function smtpTestTimeoutMessage(seconds: number): string {
  return `SMTP test did not complete within ${seconds} seconds. Check server, port, SSL/TLS, and auth method.`;
}

function parseScopeSet(scopeValue: string | undefined): Set<string> {
  if (!scopeValue) return new Set();
  return new Set(
    scopeValue
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

function parseRequestedScopesFromError(message: string): string | null {
  const match = message.match(/requested_scopes="([^"]*)"/i);
  return match?.[1] ?? null;
}

/** Map UI security value ("ssl") to Rust config value ("tls") */
function mapSecurity(security: string): string {
  if (security === "ssl") return "tls";
  return security;
}

function normalizeKnownImapProviderPort(host: string, port: number): number {
  const normalizedHost = host.trim().toLowerCase();
  if ((normalizedHost === "imap.yandex.ru" || normalizedHost === "imap.yandex.com") && port === 933) return 993;
  return port;
}

function normalizeKnownSmtpProviderPort(host: string, port: number): number {
  const normalizedHost = host.trim().toLowerCase();
  if ((normalizedHost === "smtp.yandex.ru" || normalizedHost === "smtp.yandex.com") && [25, 143, 933, 993].includes(port)) {
    return 465;
  }
  return port;
}

function formatSmtpTestError(err: unknown, host: string, port: number): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/refused|connection refused|отверг запрос|os error 10061/i.test(message)) {
    return `SMTP server ${host}:${port} refused the TCP connection. Check port and security type: for Yandex Mail use smtp.yandex.ru, port 465, SSL/TLS. If settings are correct, the port may be blocked by network, VPN, proxy, or antivirus.`;
  }
  return message;
}

function enrichSmtpTestUserFacingMessage(
  raw: string,
  ctx: { authMode: AuthMode; smtpHost: string; smtpPort: number },
): string {
  if (/SMTP test did not complete within|SMTP test timed out after/i.test(raw)) {
    return raw;
  }
  let m = formatSmtpTestError(raw, ctx.smtpHost, ctx.smtpPort);
  if (ctx.authMode === "oauth2") {
    if (/5\.7\.8|535|authentication failed|auth.*fail|xoauth2|invalid.*credential|expected.*AUTH/i.test(raw)) {
      return SMTP_SCOPE_MISSING;
    }
  }
  if (ctx.authMode === "password") {
    const h = ctx.smtpHost.toLowerCase();
    if (
      (h.includes("yandex.ru") || h.includes("yandex.com")) &&
      /auth|535|invalid|password|credentials|5\.7\.|authentication/i.test(m)
    ) {
      return SMTP_YANDEX_APP_PASSWORD_HINT;
    }
  }
  return m;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export function AddImapAccount({
  onClose,
  onSuccess,
  onBack,
  oauthPreset,
}: AddImapAccountProps) {
  const [currentStep, setCurrentStep] = useState<Step>("basic");
  const [form, setForm] = useState<FormState>(() => {
    if (!oauthPreset) return initialFormState;

    const discovered = discoverSettings(oauthPreset.defaultEmail);
    return {
      ...initialFormState,
      email: "",
      imapHost: discovered?.settings.imapHost ?? "imap.yandex.com",
      imapPort: discovered?.settings.imapPort ?? 993,
      imapSecurity: discovered?.settings.imapSecurity ?? "ssl",
      smtpHost: discovered?.settings.smtpHost ?? "smtp.yandex.com",
      smtpPort: discovered?.settings.smtpPort ?? 465,
      smtpSecurity: discovered?.settings.smtpSecurity ?? "ssl",
      authMode: "oauth2",
      oauthProvider: oauthPreset.providerId,
      acceptInvalidCerts: discovered?.acceptInvalidCerts ?? false,
      oauthGrantedScopes: null,
    };
  });
  const [imapTest, setImapTest] = useState<TestStatus>({ state: "idle" });
  const [smtpTest, setSmtpTest] = useState<TestStatus>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discoveryApplied, setDiscoveryApplied] = useState(!!oauthPreset);
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [detectedAuthMethods, setDetectedAuthMethods] = useState<AuthMode[]>(
    oauthPreset ? ["oauth2", "password"] : ["password"],
  );
  const [detectedOAuthProviderId, setDetectedOAuthProviderId] = useState<string | null>(
    oauthPreset?.providerId ?? null,
  );
  const [yandexManualFallback, setYandexManualFallback] = useState(false);
  const [yandexMailScopeBlocked, setYandexMailScopeBlocked] = useState(false);

  const accounts = useAccountStore((s) => s.accounts);
  const addAccount = useAccountStore((s) => s.addAccount);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);

  const usesManagedOAuthFlow = oauthPreset?.providerId === "yandex" && !yandexManualFallback;
  const visibleSteps = usesManagedOAuthFlow ? managedOAuthSteps : steps;
  const currentStepIndex = visibleSteps.indexOf(currentStep);

  const updateForm = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleEmailBlur = useCallback(() => {
    if (discoveryApplied) return;
    const result = discoverSettings(form.email);
    if (result && !form.imapHost && !form.smtpHost) {
      setForm((prev) => ({
        ...prev,
        imapHost: result.settings.imapHost,
        imapPort: result.settings.imapPort,
        imapSecurity: result.settings.imapSecurity,
        smtpHost: result.settings.smtpHost,
        smtpPort: result.settings.smtpPort,
        smtpSecurity: result.settings.smtpSecurity,
        acceptInvalidCerts: result.acceptInvalidCerts ?? false,
        // Auto-select OAuth2 if it's the only option (e.g. Outlook)
        authMode: result.authMethods[0] === "oauth2" ? "oauth2" : prev.authMode,
        oauthProvider: result.oauthProviderId ?? null,
      }));
      setDetectedAuthMethods(result.authMethods);
      setDetectedOAuthProviderId(result.oauthProviderId ?? null);
      setDiscoveryApplied(true);
    }
  }, [form.email, form.imapHost, form.smtpHost, discoveryApplied]);

  const handleImapSecurityChange = useCallback(
    (security: SecurityType) => {
      setForm((prev) => ({
        ...prev,
        imapSecurity: security,
        imapPort: getDefaultImapPort(security),
      }));
    },
    [],
  );

  const handleSmtpSecurityChange = useCallback(
    (security: SecurityType) => {
      setForm((prev) => ({
        ...prev,
        smtpSecurity: security,
        smtpPort: getDefaultSmtpPort(security),
      }));
    },
    [],
  );

  const isOAuth = form.authMode === "oauth2";
  const hasOAuthTokens = !!(form.oauthAccessToken && form.oauthRefreshToken);

  const canAdvanceFromBasic =
    form.email.trim().includes("@") &&
    (isOAuth ? hasOAuthTokens : form.password.trim().length > 0);
  const canAdvanceFromImap = form.imapHost.trim().length > 0 && form.imapPort > 0;
  const canAdvanceFromSmtp = form.smtpHost.trim().length > 0 && form.smtpPort > 0;
  const bothTestsPassed = imapTest.state === "success" && smtpTest.state === "success";

  const goNext = useCallback(() => {
    const idx = visibleSteps.indexOf(currentStep);
    if (idx < visibleSteps.length - 1) {
      setCurrentStep(visibleSteps[idx + 1]!);
    }
  }, [currentStep, visibleSteps]);

  const goPrev = useCallback(() => {
    const idx = visibleSteps.indexOf(currentStep);
    if (idx > 0) {
      setCurrentStep(visibleSteps[idx - 1]!);
    } else {
      onBack();
    }
  }, [currentStep, onBack, visibleSteps]);

  const canGoNext = (): boolean => {
    switch (currentStep) {
      case "basic":
        return canAdvanceFromBasic;
      case "imap":
        return canAdvanceFromImap;
      case "smtp":
        return canAdvanceFromSmtp;
      case "test":
        return false;
      default:
        return false;
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && currentStep !== "test" && canGoNext()) {
        e.preventDefault();
        goNext();
      }
    },
    [currentStep, goNext, canGoNext],
  );

  async function saveAccount(accountForm: FormState): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const email = (accountForm.authMode === "oauth2" ? accountForm.oauthEmail : null) ?? accountForm.email.trim();
      const existingAccount = await getAccountByEmail(email);
      const accountId = existingAccount?.id ?? crypto.randomUUID();
      const imapUsername = accountForm.imapUsername.trim() || null;
      const accountIsOAuth = accountForm.authMode === "oauth2";

      if (accountIsOAuth) {
        const accountPayload = {
          id: accountId,
          email,
          displayName: accountForm.displayName.trim() || null,
          avatarUrl: accountForm.oauthPicture,
          imapHost: accountForm.imapHost.trim(),
          imapPort: normalizeKnownImapProviderPort(accountForm.imapHost, accountForm.imapPort),
          imapSecurity: accountForm.imapSecurity,
          smtpHost: accountForm.smtpHost.trim(),
          smtpPort: normalizeKnownSmtpProviderPort(accountForm.smtpHost, accountForm.smtpPort),
          smtpSecurity: accountForm.smtpSecurity,
          accessToken: accountForm.oauthAccessToken!,
          refreshToken: accountForm.oauthRefreshToken!,
          tokenExpiresAt: accountForm.oauthExpiresAt!,
          oauthProvider: accountForm.oauthProvider!,
          oauthClientId: accountForm.oauthClientId.trim(),
          oauthClientSecret: accountForm.oauthClientSecret.trim() || null,
          imapUsername,
          acceptInvalidCerts: accountForm.acceptInvalidCerts,
        };

        if (existingAccount) {
          await updateOAuthImapAccount(accountPayload);
        } else {
          await insertOAuthImapAccount(accountPayload);
        }
      } else {
        if (existingAccount) {
          setSaveError("Аккаунт с таким email уже добавлен. Выберите его в переключателе аккаунтов или удалите старый перед повторным добавлением.");
          setSaving(false);
          return;
        }
        await insertImapAccount({
          id: accountId,
          email,
          displayName: accountForm.displayName.trim() || null,
          avatarUrl: null,
          imapHost: accountForm.imapHost.trim(),
          imapPort: normalizeKnownImapProviderPort(accountForm.imapHost, accountForm.imapPort),
          imapSecurity: accountForm.imapSecurity,
          smtpHost: accountForm.smtpHost.trim(),
          smtpPort: normalizeKnownSmtpProviderPort(accountForm.smtpHost, accountForm.smtpPort),
          smtpSecurity: accountForm.smtpSecurity,
          authMethod: "password",
          password: accountForm.samePassword ? accountForm.password : accountForm.password,
          imapUsername,
          acceptInvalidCerts: accountForm.acceptInvalidCerts,
        });
      }

      const storeAccount = {
        id: accountId,
        email,
        displayName: accountForm.displayName.trim() || (existingAccount?.display_name ?? null),
        avatarUrl: accountForm.oauthPicture ?? existingAccount?.avatar_url ?? null,
        isActive: true,
        provider: "imap",
      };

      if (accounts.some((account) => account.id === accountId)) {
        setActiveAccount(accountId);
      } else {
        addAccount(storeAccount);
      }

      onSuccess(accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      setSaving(false);
      throw err;
    }
  }

  const handleOAuthConnect = async (providerId: string) => {
    const provider = getOAuthProvider(providerId);
    if (!provider) {
      setOauthError(`Unknown provider: ${providerId}`);
      return;
    }

    if (!form.email.trim().includes("@")) {
      setOauthError("Введите email Яндекс Почты перед входом.");
      return;
    }

    const clientId = provider.publicClientId ?? form.oauthClientId.trim();
    if (!clientId) {
      if (providerId === "yandex") {
        setOauthError("В сборке приложения не настроен Yandex OAuth Client ID. Нужен зарегистрированный public client в Яндекс ID.");
      } else {
        setOauthError("Please enter a Client ID first.");
      }
      return;
    }

    setOauthConnecting(true);
    setOauthError(null);
    setYandexMailScopeBlocked(false);
    setSaveError(null);

    try {
      if (providerId === "yandex") {
        const yandexDiagnostics = getYandexOAuthConfigDiagnostics();
        const dbClientId = await getSetting("yandex_oauth_client_id");
        console.info("[oauth][yandex] DB client_id (settings:yandex_oauth_client_id):", dbClientId ?? "<empty>");
        console.info("[oauth][yandex] env client_id:", yandexDiagnostics.envClientId ?? "<empty>");
        console.info("[oauth][yandex] fallback client_id:", yandexDiagnostics.fallbackClientId);
        console.info("[oauth][yandex] provider.publicClientId:", provider.publicClientId ?? "<empty>");
        console.info("[oauth][yandex] selected client_id:", clientId);
      }

      const { tokens, userInfo } = await startProviderOAuthFlow(
        provider,
        clientId,
        provider.publicClientId ? undefined : form.oauthClientSecret.trim() || undefined,
        providerId === "yandex" ? { loginHint: form.email.trim() } : undefined,
      );
      const grantedScopes = parseScopeSet(tokens.scope);

      if (providerId === "yandex") {
        console.info("[oauth] Yandex granted scopes:", [...grantedScopes].join(" "));
        if (usesManagedOAuthFlow && !hasYandexMailScopes(grantedScopes)) {
          console.warn(
            "[oauth][yandex] mail scopes are not granted; account will not be saved",
          );
          setForm((prev) => ({
            ...prev,
            email: userInfo.email || prev.email,
            displayName: userInfo.name || prev.displayName,
            oauthAccessToken: null,
            oauthRefreshToken: null,
            oauthExpiresAt: null,
            oauthEmail: null,
            oauthPicture: null,
            oauthGrantedScopes: tokens.scope ?? null,
          }));
          setYandexMailScopeBlocked(true);
          return;
        }
      }

      const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

      const nextForm: FormState = {
        ...form,
        oauthAccessToken: tokens.access_token,
        oauthRefreshToken: tokens.refresh_token ?? null,
        oauthExpiresAt: expiresAt,
        oauthEmail: userInfo.email,
        oauthPicture: userInfo.picture ?? null,
        email: userInfo.email || form.email,
        displayName: userInfo.name || form.displayName,
        oauthProvider: providerId,
        oauthClientId: clientId,
        oauthClientSecret: provider.publicClientId ? "" : form.oauthClientSecret,
        oauthGrantedScopes: tokens.scope ?? null,
      };

      setForm(nextForm);
      if (usesManagedOAuthFlow) {
        await saveAccount(nextForm);
      } else {
        setCurrentStep("imap");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (providerId === "yandex" && /invalid_scope/i.test(message)) {
        const requestedScopes = parseRequestedScopesFromError(message) ?? provider.scopes.join(" ");
        setOauthError(
          `OAuth scopes не разрешены для этого client_id. Запрошенные scopes: ${requestedScopes}`,
        );
      } else {
        setOauthError(message);
      }
    } finally {
      setOauthConnecting(false);
    }
  };

  const testImapConnection = async () => {
    setImapTest({ state: "testing" });
    try {
      const imapHost = form.imapHost.trim();
      const imapPort = normalizeKnownImapProviderPort(imapHost, form.imapPort);
      const result = await withTimeout(
        invoke<string>(
          "imap_test_connection",
          {
            config: {
              host: imapHost,
              port: imapPort,
              security: mapSecurity(form.imapSecurity),
              username: form.imapUsername || (isOAuth ? (form.oauthEmail ?? form.email) : form.email),
              password: isOAuth ? (form.oauthAccessToken ?? "") : form.password,
              auth_method: isOAuth ? "oauth2" : "password",
              accept_invalid_certs: form.acceptInvalidCerts,
            },
          },
        ),
        IMAP_TEST_TIMEOUT_MS,
        `IMAP-проверка ${imapHost}:${imapPort} не ответила за ${IMAP_TEST_TIMEOUT_MS / 1000} сек. Для Яндекса проверьте, что IMAP включен в настройках почты и используются host imap.yandex.ru, порт 993, SSL/TLS.`,
      );
      setImapTest({ state: "success", message: result });
    } catch (err) {
      const diagnostic = createConnectionDiagnostic(err, {
        layer: "imap",
        operation: "test_connection",
        provider: "imap",
        authMethod: form.authMode,
      });
      setImapTest({ state: "error", message: diagnostic.userMessage, diagnostic });
    }
  };

  const testSmtpConnection = async () => {
    setSmtpTest({ state: "testing" });
    const smtpHost = form.smtpHost.trim();
    const smtpPort = normalizeKnownSmtpProviderPort(smtpHost, form.smtpPort);
    const username =
      form.imapUsername.trim() ||
      (isOAuth ? (form.oauthEmail ?? form.email).trim() : form.email.trim());
    const authMethod: "oauth2" | "password" = isOAuth ? "oauth2" : "password";
    const t0 = performance.now();

    const logSmtpDiag = (phase: "start" | "success" | "error", detail?: string) => {
      const elapsedMs = Math.round(performance.now() - t0);
      console.info(
        "[smtp:test]",
        JSON.stringify({
          phase,
          elapsedMs,
          host: smtpHost,
          port: smtpPort,
          security: form.smtpSecurity,
          securityMapped: mapSecurity(form.smtpSecurity),
          authMethod,
          username,
          ...(detail ? { detail } : {}),
        }),
      );
    };

    logSmtpDiag("start");

    try {
      if (
        isOAuth &&
        (smtpHost.toLowerCase().includes("yandex") || form.oauthProvider === "yandex") &&
        form.oauthGrantedScopes
      ) {
        const scopes = parseScopeSet(form.oauthGrantedScopes);
        if (!scopes.has("mail:smtp")) {
          const msg = SMTP_SCOPE_MISSING;
          const diagnostic = createConnectionDiagnostic("missing SMTP scope mail:smtp", {
            layer: "smtp",
            operation: "test_connection",
            provider: "imap",
            authMethod: form.authMode,
          });
          setSmtpTest({ state: "error", message: msg, diagnostic: { ...diagnostic, userMessage: msg } });
          logSmtpDiag("error", msg);
          return;
        }
      }

      const smtpPassword = isOAuth
        ? (form.oauthAccessToken ?? "")
        : form.samePassword
          ? form.password
          : form.smtpPassword;

      const result = await withTimeout(
        invoke<{ success: boolean; message: string }>("smtp_test_connection", {
          config: {
            host: smtpHost,
            port: smtpPort,
            security: mapSecurity(form.smtpSecurity),
            username,
            password: smtpPassword,
            auth_method: authMethod,
            accept_invalid_certs: form.acceptInvalidCerts,
          },
        }),
        SMTP_TEST_TIMEOUT_MS,
        smtpTestTimeoutMessage(SMTP_TEST_TIMEOUT_MS / 1000),
      );

      if (!result.success) {
        const rawMsg = result.message || "SMTP check failed";
        const message = enrichSmtpTestUserFacingMessage(rawMsg, {
          authMode: form.authMode,
          smtpHost,
          smtpPort,
        });
        const diagnostic = createConnectionDiagnostic(rawMsg, {
          layer: "smtp",
          operation: "test_connection",
          provider: "imap",
          authMethod: form.authMode,
        });
        setSmtpTest({ state: "error", message, diagnostic: { ...diagnostic, userMessage: message } });
        logSmtpDiag("error", message);
        return;
      }

      setSmtpTest({
        state: "success",
        message: result.message,
      });
      logSmtpDiag("success", result.message);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = enrichSmtpTestUserFacingMessage(raw, {
        authMode: form.authMode,
        smtpHost,
        smtpPort,
      });
      const diagnostic = createConnectionDiagnostic(raw, {
        layer: "smtp",
        operation: "test_connection",
        provider: "imap",
        authMethod: form.authMode,
      });
      setSmtpTest({ state: "error", message, diagnostic: { ...diagnostic, userMessage: message } });
      logSmtpDiag("error", message);
    }
  };

  const testBothConnections = async () => {
    const imapOk = imapTest.state === "success";
    const smtpOk = smtpTest.state === "success";

    if (imapOk && !smtpOk) {
      await testSmtpConnection();
      return;
    }
    if (!imapOk && smtpOk) {
      await testImapConnection();
      return;
    }

    await Promise.all([testImapConnection(), testSmtpConnection()]);
  };

  const handleSave = async () => {
    await saveAccount(form).catch(() => {});
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-1 mb-6">
      {visibleSteps.map((step, i) => {
        const isActive = i === currentStepIndex;
        const isCompleted = i < currentStepIndex;
        return (
          <div key={step} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`w-6 h-px ${isCompleted ? "bg-accent" : "bg-border-primary"}`}
              />
            )}
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : isCompleted
                    ? "text-accent"
                    : "text-text-tertiary"
              }`}
            >
              {stepIcons[step]}
              <span className="hidden sm:inline">{stepLabels[step]}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  const handleYandexSignInAgain = () => {
    setYandexMailScopeBlocked(false);
    setOauthError(null);
    setSaveError(null);
    setForm((prev) => ({
      ...prev,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthExpiresAt: null,
      oauthEmail: null,
      oauthPicture: null,
      oauthGrantedScopes: null,
    }));
    void handleOAuthConnect("yandex");
  };

  const switchToYandexManualSetup = () => {
    setYandexManualFallback(true);
    setYandexMailScopeBlocked(false);
    setOauthError(null);
    setSaveError(null);
    setForm((prev) => ({
      ...prev,
      authMode: "password",
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthExpiresAt: null,
      oauthEmail: null,
      oauthPicture: null,
      oauthGrantedScopes: null,
    }));
    setCurrentStep("basic");
  };

  const renderYandexMailScopeError = () => (
    <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger space-y-2">
      <p className="font-medium">{YANDEX_MAIL_SCOPES_MISSING_TITLE}</p>
      <p className="text-xs">{YANDEX_MAIL_SCOPES_REQUIRED}</p>
      <p className="text-xs">{YANDEX_MAIL_SCOPES_MISSING_BODY}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={handleYandexSignInAgain}
          disabled={oauthConnecting || saving}
          className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Sign in again
        </button>
        <button
          type="button"
          onClick={switchToYandexManualSetup}
          disabled={oauthConnecting || saving}
          className="px-3 py-1.5 text-xs font-medium border border-border-primary rounded-lg text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Use app password
        </button>
        <button
          type="button"
          onClick={switchToYandexManualSetup}
          disabled={oauthConnecting || saving}
          className="px-3 py-1.5 text-xs font-medium border border-border-primary rounded-lg text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Set up manually
        </button>
      </div>
    </div>
  );

  const renderAuthModeSelector = () => {
    if (usesManagedOAuthFlow) return null;

    const showOAuth = detectedAuthMethods.includes("oauth2") || form.authMode === "oauth2";
    if (!showOAuth) return null;

    return (
      <div className="mb-4">
        <label className={labelClass}>Authentication Method</label>
        <div className="flex gap-2">
          {detectedAuthMethods.includes("password") && (
            <button
              type="button"
              onClick={() => updateForm("authMode", "password")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
                form.authMode === "password"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-primary bg-bg-secondary text-text-secondary hover:bg-bg-hover"
              }`}
            >
              <KeyRound className="w-4 h-4" />
              Password
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              updateForm("authMode", "oauth2");
              if (detectedOAuthProviderId) {
                updateForm("oauthProvider", detectedOAuthProviderId);
              }
            }}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
              form.authMode === "oauth2"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-primary bg-bg-secondary text-text-secondary hover:bg-bg-hover"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            OAuth2
          </button>
        </div>
      </div>
    );
  };

  const renderOAuthSection = () => {
    const providerId = form.oauthProvider ?? detectedOAuthProviderId;
    const provider = providerId ? getOAuthProvider(providerId) : null;
    const usesManagedPublicClient = providerId === "yandex" || !!provider?.publicClientId;
    const canStartOAuth =
      form.email.trim().includes("@") &&
      (usesManagedPublicClient ? !!provider?.publicClientId : !!form.oauthClientId.trim());
    const providerName =
      providerId === "microsoft"
        ? "Microsoft"
        : providerId === "yahoo"
          ? "Yahoo"
          : providerId === "yandex"
            ? "Яндекс ID"
            : "Provider";

    return (
      <div className="space-y-3">
        {!usesManagedPublicClient && (
          <>
            <div>
              <label htmlFor="oauth-client-id" className={labelClass}>
                Client ID
              </label>
              <input
                id="oauth-client-id"
                type="text"
                value={form.oauthClientId}
                onChange={(e) => updateForm("oauthClientId", e.target.value)}
                placeholder={`${providerName} app Client ID`}
                className={inputClass}
                disabled={hasOAuthTokens}
              />
            </div>
            <div>
              <label htmlFor="oauth-client-secret" className={labelClass}>
                Client Secret (optional)
              </label>
              <input
                id="oauth-client-secret"
                type="password"
                value={form.oauthClientSecret}
                onChange={(e) => updateForm("oauthClientSecret", e.target.value)}
                placeholder="Leave blank for public clients"
                className={inputClass}
                disabled={hasOAuthTokens}
              />
            </div>
          </>
        )}

        {hasOAuthTokens ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
            <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
            <div className="text-sm text-success">
              Connected as <span className="font-medium">{form.oauthEmail}</span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => providerId && handleOAuthConnect(providerId)}
            disabled={oauthConnecting || saving || !canStartOAuth}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {oauthConnecting || saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {oauthConnecting ? "Подключение..." : "Сохранение..."}
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Войти через {providerName}
              </>
            )}
          </button>
        )}

        {yandexMailScopeBlocked && usesManagedOAuthFlow
          ? renderYandexMailScopeError()
          : oauthError && (
              <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
                {oauthError}
              </div>
            )}
        {providerId === "yandex" && (
          <div className="text-xs text-text-tertiary">
            client_id: <code className="text-accent">{(provider?.publicClientId ?? form.oauthClientId.trim()) || "<empty>"}</code>
          </div>
        )}

        {providerId === "microsoft" && (
          <div className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs text-text-secondary">
            Microsoft sign-in here connects mail through OAuth-protected IMAP/SMTP. Native Exchange/Graph mail, shared mailboxes, Exchange calendar, and Exchange contacts are planned but unavailable in this build.
          </div>
        )}

        {saveError && usesManagedOAuthFlow && (
          <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
            {saveError}
          </div>
        )}

        <p className="text-xs text-text-tertiary">
          {usesManagedPublicClient
            ? "Введите email и подтвердите вход в браузере. После успешной авторизации аккаунт и календарь будут добавлены автоматически."
            : <>Чтобы получить Client ID, зарегистрируйте приложение в {providerName}.{" "}</>}
          {providerId === "microsoft" && (
            <>Register at the Azure Portal (App Registrations) with redirect URI <code className="text-accent">http://127.0.0.1:17248</code> and IMAP/SMTP OAuth scopes.</>
          )}
          {providerId === "yahoo" && (
            <>Register at the Yahoo Developer Network with redirect URI <code className="text-accent">http://127.0.0.1:17248</code>.</>
          )}
          {providerId === "yandex" && !usesManagedPublicClient && (
            <>Создайте приложение на <code className="text-accent">oauth.yandex.ru</code>, добавьте redirect URI <code className="text-accent">http://localhost:17248</code> и выдайте scopes <code className="text-accent">mail:imap_full</code>, <code className="text-accent">mail:smtp</code>, <code className="text-accent">calendar:all</code> (CalDAV), <code className="text-accent">login:email</code>, <code className="text-accent">login:info</code>, <code className="text-accent">login:avatar</code> (аватар — только с <code className="text-accent">default_avatar_id</code> по <a className="text-accent underline" href="https://yandex.com/dev/id/doc/en/user-information" target="_blank" rel="noreferrer">документации Яндекс ID</a>).</>
          )}
        </p>
      </div>
    );
  };

  const renderBasicStep = () => (
    <div className="space-y-4">
      <div>
        <label htmlFor="imap-email" className={labelClass}>
          Email Address
        </label>
        <input
          id="imap-email"
          type="email"
          value={form.email}
          onChange={(e) => updateForm("email", e.target.value)}
          onBlur={handleEmailBlur}
          placeholder="you@example.com"
          className={inputClass}
          autoFocus
          disabled={isOAuth && hasOAuthTokens}
        />
      </div>

      {renderAuthModeSelector()}

      {isOAuth ? (
        renderOAuthSection()
      ) : (
        <>
          <div>
            <label htmlFor="imap-display-name" className={labelClass}>
              Display Name (optional)
            </label>
            <input
              id="imap-display-name"
              type="text"
              value={form.displayName}
              onChange={(e) => updateForm("displayName", e.target.value)}
              placeholder="Your Name"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="imap-username" className={labelClass}>
              Username (optional)
            </label>
            <input
              id="imap-username"
              type="text"
              value={form.imapUsername}
              onChange={(e) => updateForm("imapUsername", e.target.value)}
              placeholder="Leave blank to use your email address"
              className={inputClass}
            />
            <p className="text-xs text-text-tertiary mt-1">
              Only needed if your login username differs from your email address.
            </p>
          </div>
          <div>
            <label htmlFor="imap-password" className={labelClass}>
              Password / App Password
            </label>
            <input
              id="imap-password"
              type="password"
              value={form.password}
              onChange={(e) => updateForm("password", e.target.value)}
              placeholder="Enter your email password or app password"
              className={inputClass}
            />
            <p className="text-xs text-text-tertiary mt-1">
              For Yandex Mail, use an app password from Yandex ID settings.
            </p>
          </div>
        </>
      )}

      {isOAuth && hasOAuthTokens && (
        <div>
          <label htmlFor="imap-display-name" className={labelClass}>
            Display Name (optional)
          </label>
          <input
            id="imap-display-name"
            type="text"
            value={form.displayName}
            onChange={(e) => updateForm("displayName", e.target.value)}
            placeholder="Your Name"
            className={inputClass}
          />
        </div>
      )}
    </div>
  );

  const renderImapStep = () => (
    <div className="space-y-4">
      {isOAuth && (
        <p className="text-xs text-text-tertiary">
          Server settings have been auto-configured for your provider. You can adjust them if needed.
        </p>
      )}
      <div>
        <label htmlFor="imap-host" className={labelClass}>
          IMAP Server
        </label>
        <input
          id="imap-host"
          type="text"
          value={form.imapHost}
          onChange={(e) => updateForm("imapHost", e.target.value)}
          placeholder="imap.example.com"
          className={inputClass}
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="imap-port" className={labelClass}>
            Port
          </label>
          <input
            id="imap-port"
            type="number"
            value={form.imapPort}
            onChange={(e) =>
              updateForm("imapPort", parseInt(e.target.value, 10) || 0)
            }
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="imap-security" className={labelClass}>
            Security
          </label>
          <select
            id="imap-security"
            value={form.imapSecurity}
            onChange={(e) =>
              handleImapSecurityChange(e.target.value as SecurityType)
            }
            className={selectClass}
          >
            <option value="ssl">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="accept-invalid-certs"
          type="checkbox"
          checked={form.acceptInvalidCerts}
          onChange={(e) => updateForm("acceptInvalidCerts", e.target.checked)}
          className="rounded border-border-primary text-accent focus:ring-accent"
        />
        <label
          htmlFor="accept-invalid-certs"
          className="text-sm text-text-secondary"
        >
          Accept self-signed certificates
        </label>
      </div>
      <p className="text-xs text-text-tertiary -mt-2 ml-6">
        Enable for local mail bridges like ProtonMail Bridge
      </p>
    </div>
  );

  const renderSmtpStep = () => (
    <div className="space-y-4">
      {isOAuth && (
        <p className="text-xs text-text-tertiary">
          Server settings have been auto-configured for your provider. You can adjust them if needed.
        </p>
      )}
      <div>
        <label htmlFor="smtp-host" className={labelClass}>
          SMTP Server
        </label>
        <input
          id="smtp-host"
          type="text"
          value={form.smtpHost}
          onChange={(e) => updateForm("smtpHost", e.target.value)}
          placeholder="smtp.example.com"
          className={inputClass}
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="smtp-port" className={labelClass}>
            Port
          </label>
          <input
            id="smtp-port"
            type="number"
            value={form.smtpPort}
            onChange={(e) =>
              updateForm("smtpPort", parseInt(e.target.value, 10) || 0)
            }
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="smtp-security" className={labelClass}>
            Security
          </label>
          <select
            id="smtp-security"
            value={form.smtpSecurity}
            onChange={(e) =>
              handleSmtpSecurityChange(e.target.value as SecurityType)
            }
            className={selectClass}
          >
            <option value="ssl">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>
      {!isOAuth && (
        <>
          <div className="flex items-center gap-2">
            <input
              id="smtp-same-password"
              type="checkbox"
              checked={form.samePassword}
              onChange={(e) => updateForm("samePassword", e.target.checked)}
              className="rounded border-border-primary text-accent focus:ring-accent"
            />
            <label
              htmlFor="smtp-same-password"
              className="text-sm text-text-secondary"
            >
              Use same password as IMAP
            </label>
          </div>
          {!form.samePassword && (
            <div>
              <label htmlFor="smtp-password" className={labelClass}>
                SMTP Password
              </label>
              <input
                id="smtp-password"
                type="password"
                value={form.smtpPassword}
                onChange={(e) => updateForm("smtpPassword", e.target.value)}
                placeholder="SMTP password"
                className={inputClass}
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderTestResult = (label: string, status: TestStatus) => {
    const icon =
      status.state === "testing" ? (
        <Loader2 className="w-4 h-4 animate-spin text-accent" />
      ) : status.state === "success" ? (
        <CheckCircle2 className="w-4 h-4 text-success" />
      ) : status.state === "error" ? (
        <XCircle className="w-4 h-4 text-danger" />
      ) : (
        <div className="w-4 h-4 rounded-full border-2 border-border-primary" />
      );

    return (
      <div className="flex items-start gap-3 p-3 rounded-lg bg-bg-secondary border border-border-primary">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary">{label}</div>
          {status.message && (
            <div
              className={`text-xs mt-0.5 ${
                status.state === "error"
                  ? "text-danger"
                  : status.state === "success"
                    ? "text-success"
                    : "text-text-tertiary"
              }`}
            >
              {status.message}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTestStep = () => (
    <div className="space-y-4">
      <div className="text-sm text-text-secondary mb-2">
        Test your connection settings before adding the account.
      </div>

      <div className="space-y-3">
        {renderTestResult("IMAP Connection", imapTest)}
        {renderTestResult("SMTP Connection", smtpTest)}
      </div>

      <button
        onClick={testBothConnections}
        disabled={imapTest.state === "testing" || smtpTest.state === "testing"}
        className="w-full px-4 py-2 text-sm bg-bg-secondary border border-border-primary rounded-lg text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {imapTest.state === "testing" || smtpTest.state === "testing"
          ? "Checking..."
          : imapTest.state === "idle" && smtpTest.state === "idle"
            ? "Test Connection"
            : "Re-test Connection"}
      </button>

      {saveError && (
        <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
          {saveError}
        </div>
      )}
    </div>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case "basic":
        return renderBasicStep();
      case "imap":
        return renderImapStep();
      case "smtp":
        return renderSmtpStep();
      case "test":
        return renderTestStep();
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={oauthPreset?.title ?? "Add IMAP/SMTP Account"}
      width="w-full max-w-lg"
    >
      <div className="p-4" onKeyDown={handleKeyDown}>
        {oauthPreset && (
          <p className="text-sm text-text-secondary mb-4">
            {oauthPreset.description}
          </p>
        )}
        {renderStepIndicator()}
        {renderStepContent()}

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={goPrev}
            className="flex items-center gap-1 px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>

            {((usesManagedOAuthFlow && !isOAuth) || !usesManagedOAuthFlow) && (currentStep === "test" ? (
              <button
                onClick={handleSave}
                disabled={!bothTestsPassed || saving}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Adding..." : "Add Account"}
              </button>
            ) : (
              <button
                onClick={usesManagedOAuthFlow && !isOAuth ? handleSave : goNext}
                disabled={usesManagedOAuthFlow && !isOAuth ? !canAdvanceFromBasic || saving : !canGoNext()}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {usesManagedOAuthFlow && !isOAuth ? (saving ? "Adding..." : "Add Account") : "Next"}
                {!(usesManagedOAuthFlow && !isOAuth) && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
