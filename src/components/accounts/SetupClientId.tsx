import { useState } from "react";
import { setSetting, setSecureSetting } from "@/services/db/settings";
import { Modal } from "@/components/ui/Modal";
import { useUIStore } from "@/stores/uiStore";
import { isValidGoogleOAuthClientIdFormat } from "@/utils/googleCredentials";

interface SetupClientIdProps {
  onComplete: () => void;
  onCancel: () => void;
}

export function SetupClientId({ onComplete, onCancel }: SetupClientIdProps) {
  const locale = useUIStore((s) => s.locale);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmedId = clientId.trim();
    const trimmedSecret = clientSecret.trim();
    if (!trimmedId) return;

    if (!isValidGoogleOAuthClientIdFormat(trimmedId)) {
      setError(
        locale === "ru"
          ? "Неверный формат Client ID. Скопируйте его из Google Cloud Console → Учётные данные (тип «Компьютерное приложение»)."
          : "Invalid Client ID format. Copy it from Google Cloud Console → Credentials (Desktop app).",
      );
      return;
    }
    setError(null);

    setSaving(true);
    try {
      await setSetting("google_client_id", trimmedId);
      if (trimmedSecret) {
        await setSecureSetting("google_client_secret", trimmedSecret);
      }
      onComplete();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onCancel} title="Google API Setup" width="w-full max-w-lg">
      <div className="p-4">
        <p className="text-text-secondary text-sm mb-4">
          To connect Gmail accounts, you need a Google Cloud OAuth Client ID.
        </p>

        <ol className="text-text-secondary text-sm mb-4 space-y-1 list-decimal list-inside">
          <li>
            Go to the{" "}
            <span className="text-accent">Google Cloud Console</span>
          </li>
          <li>Create a project (or use an existing one)</li>
          <li>Enable the Gmail API and Google Calendar API</li>
          <li>
            On the OAuth consent screen, add your Gmail address to Test users while the app is in Testing mode
          </li>
          <li>
            Create OAuth 2.0 credentials (Desktop application type)
          </li>
          <li>
            Add yourself as a test user on the OAuth consent screen
          </li>
          <li>Copy the Client ID below</li>
        </ol>

        <input
          type="text"
          value={clientId}
          onChange={(e) => {
            setError(null);
            setClientId(e.target.value);
          }}
          placeholder="Paste your Client ID here..."
          className="w-full px-3 py-2 bg-bg-secondary border border-border-primary rounded-lg text-sm mb-3 outline-none focus:border-accent"
        />

        {error && <p className="text-xs text-danger mb-2">{error}</p>}

        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Optional Client Secret (usually blank for Desktop apps)"
          className="w-full px-3 py-2 bg-bg-secondary border border-border-primary rounded-lg text-sm mb-1 outline-none focus:border-accent"
        />
        <p className="text-text-tertiary text-xs mb-4">
          Usually not required for Desktop application credentials with PKCE.
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!clientId.trim() || saving}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save & Continue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
