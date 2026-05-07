import { useState, useCallback, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import {
  discoverCalDavSettings,
  testCalDavConnection,
  testCalDavOAuthConnection,
} from "@/services/calendar/autoDiscovery";
import { updateAccountCalDav, type DbAccount } from "@/services/db/accounts";
import { removeCalendarProvider } from "@/services/calendar/providerFactory";
import { isYandexOAuthCalendarAccount, YANDEX_CALDAV_URL } from "@/services/calendar/yandex";

const SAVED_PASSWORD_MASK = "••••••••";

interface CalDavSettingsProps {
  account: DbAccount;
  onSaved: () => void;
}

export function CalDavSettings({ account, onSaved }: CalDavSettingsProps) {
  const [caldavUrl, setCaldavUrl] = useState(
    account.caldav_url ?? (isYandexOAuthCalendarAccount(account) ? YANDEX_CALDAV_URL : ""),
  );
  const [username, setUsername] = useState(account.caldav_username ?? account.email);
  const [password, setPassword] = useState(account.caldav_password ? SAVED_PASSWORD_MASK : "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [discovered, setDiscovered] = useState(false);
  const usesOAuthCalendar = isYandexOAuthCalendarAccount(account);
  const hasSavedPassword = !!account.caldav_password;
  const passwordWasChanged = password !== "" && password !== SAVED_PASSWORD_MASK;
  const effectivePassword =
    password === SAVED_PASSWORD_MASK
      ? (account.caldav_password ?? "")
      : password;
  const canSubmit =
    !!caldavUrl.trim() &&
    !!username.trim() &&
    (usesOAuthCalendar || !!effectivePassword);

  useEffect(() => {
    setCaldavUrl(account.caldav_url ?? (isYandexOAuthCalendarAccount(account) ? YANDEX_CALDAV_URL : ""));
    setUsername(account.caldav_username ?? account.email);
    setPassword(account.caldav_password ? SAVED_PASSWORD_MASK : "");
    setTestResult(null);
  }, [account.id, account.email, account.caldav_url, account.caldav_username, account.caldav_password]);

  // Auto-discover on mount if not already configured
  useEffect(() => {
    if (!account.caldav_url && !discovered) {
      setDiscovered(true);
      discoverCalDavSettings(account.email).then((result) => {
        if (result.caldavUrl) {
          setCaldavUrl(result.caldavUrl);
        }
      });
    }
  }, [account.email, account.caldav_url, discovered]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    const result = usesOAuthCalendar
      ? await testCalDavOAuthConnection(account, caldavUrl)
      : await testCalDavConnection(caldavUrl, username, effectivePassword);
    setTestResult(result);
    setTesting(false);
  }, [account, caldavUrl, username, effectivePassword, usesOAuthCalendar]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateAccountCalDav(account.id, {
        caldavUrl,
        caldavUsername: username,
        caldavPassword: usesOAuthCalendar ? "" : effectivePassword,
        calendarProvider: "caldav",
      });
      removeCalendarProvider(account.id);
      onSaved();
    } catch (err) {
      console.error("Failed to save CalDAV settings:", err);
    } finally {
      setSaving(false);
    }
  }, [account.id, caldavUrl, username, effectivePassword, onSaved, usesOAuthCalendar]);

  const handleRemove = useCallback(async () => {
    setSaving(true);
    try {
      await updateAccountCalDav(account.id, {
        caldavUrl: "",
        caldavUsername: "",
        caldavPassword: "",
        calendarProvider: "",
      });
      removeCalendarProvider(account.id);
      setCaldavUrl("");
      setUsername(account.email);
      setPassword("");
      setTestResult(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [account.id, account.email, onSaved]);

  const isConfigured = !!account.caldav_url || usesOAuthCalendar;
  const authDescription = usesOAuthCalendar
    ? "Календарь Яндекса будет использовать тот же OAuth-токен, что и IMAP/SMTP. Отдельный пароль приложения не нужен."
    : "Connect a CalDAV calendar server to enable calendar features for this IMAP account.";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-primary">Calendar (CalDAV)</h4>
        {isConfigured && (
          <span className="text-xs text-success font-medium">Connected</span>
        )}
      </div>
      <p className="text-xs text-text-tertiary">
        {authDescription}
      </p>

      <TextField
        label="CalDAV Server URL"
        type="url"
        value={caldavUrl}
        onChange={(e) => setCaldavUrl(e.target.value)}
        placeholder="https://caldav.example.com/"
      />

      <TextField
        label="Username"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="your@email.com"
      />

      {usesOAuthCalendar ? (
        <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-xs text-text-secondary">
          OAuth уже подключен для этого Яндекс-аккаунта. Календарь будет синхронизироваться через{" "}
          <code className="text-accent">{YANDEX_CALDAV_URL}</code> без повторного входа.
        </div>
      ) : (
        <TextField
          label="Password / App Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onFocus={() => {
            if (password === SAVED_PASSWORD_MASK) setPassword("");
          }}
          onBlur={() => {
            if (!password && hasSavedPassword) setPassword(SAVED_PASSWORD_MASK);
          }}
          placeholder={hasSavedPassword ? "Пароль сохранен. Введите новый, чтобы заменить" : "Пароль приложения"}
        />
      )}
      {!caldavUrl.trim() && (
        <p className="text-xs text-danger">
          Укажите URL сервера CalDAV. Для Яндекса обычно используется https://caldav.yandex.ru/
        </p>
      )}
      {!usesOAuthCalendar && hasSavedPassword && !passwordWasChanged && (
        <p className="text-xs text-text-tertiary">
          Пароль уже сохранен и показан маской. Чтобы заменить его, очистите поле и введите новый пароль приложения.
        </p>
      )}

      {testResult && (
        <div className={`flex items-center gap-2 text-xs ${testResult.success ? "text-success" : "text-danger"}`}>
          {testResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {testResult.message}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleTest}
          disabled={testing || !canSubmit}
        >
          {testing && <Loader2 size={14} className="animate-spin" />}
          {testing ? "Testing..." : "Test Connection"}
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !canSubmit}
        >
          {saving ? "Saving..." : "Save"}
        </Button>

        {isConfigured && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={saving}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
