import { useEffect, useState } from "react";
import { getAccount, updateImapAccountPassword } from "@/services/db/accounts";
import { TextField } from "@/components/ui/TextField";
import { Button } from "@/components/ui/Button";

interface ImapCredentialsEditorProps {
  accountId: string;
  onClose: () => void;
}

export function ImapCredentialsEditor({ accountId, onClose }: ImapCredentialsEditorProps) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      const account = await getAccount(accountId);
      if (!account || cancelled) return;
      setEmail(account.email);
      setUsername(account.imap_username ?? account.email);
      setPassword("");
      setHasSavedPassword(!!account.imap_password);
      setStatus("idle");
      setError(null);
    }

    loadAccount().catch((err) => {
      console.error("Failed to load IMAP account settings:", err);
      if (!cancelled) {
        setError("Не удалось загрузить настройки IMAP-аккаунта");
        setStatus("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const handleSave = async () => {
    if (!password.trim()) {
      setError("Введите новый пароль приложения");
      setStatus("error");
      return;
    }

    setSaving(true);
    setStatus("idle");
    setError(null);

    try {
      await updateImapAccountPassword(accountId, password, username.trim() || email);
      setPassword("");
      setHasSavedPassword(true);
      setStatus("done");
    } catch (err) {
      console.error("Failed to save IMAP password:", err);
      setError(err instanceof Error ? err.message : "Не удалось сохранить пароль");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Авторизация IMAP
          </h3>
          <p className="text-xs text-text-tertiary mt-1">
            {email ? `Аккаунт: ${email}` : "Загрузка аккаунта..."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
        >
          Закрыть
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextField
          label="Логин IMAP/SMTP"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={email || "email@example.com"}
        />
        <TextField
          label="Пароль приложения"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={hasSavedPassword ? "•••••••• Пароль сохранен. Введите новый, чтобы заменить" : "Введите пароль приложения"}
        />
      </div>

      <p className="text-xs text-text-tertiary">
        Сохраненный пароль не показывается полностью из соображений безопасности. Для повторной авторизации введите новый пароль приложения Яндекс/IMAP и сохраните.
      </p>

      {status === "done" && (
        <p className="text-xs text-success">
          Пароль сохранен. Запустите пересинхронизацию аккаунта, чтобы проверить подключение.
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || !password.trim()}>
          {saving ? "Сохранение..." : "Сохранить пароль"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
