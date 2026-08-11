import { useCallback, useEffect, useRef, useState } from "react";
import { blockUIFactory, createMultiChatsWidget } from "yandex-messenger-widget";
import "yandex-messenger-widget/lib/ui/block.css";
import {
  authorizeYandexGrant,
  getYandexGrantAccessToken,
  getYandexUnifiedAuthStatus,
} from "@/services/oauth/yandexUnifiedAuth";
import { getInitialLocale, translateText } from "@/i18n";

interface YandexMessengerWidgetProps {
  accountId: string | null;
}

type WidgetPhase = "loading" | "needs_access" | "ready" | "error";

function isMissingCommunicationsGrant(message: string): boolean {
  return /Подключите раздел|другой Яндекс ID|NEEDS ACCESS|communications/i.test(message);
}

export function YandexMessengerWidget({ accountId }: YandexMessengerWidgetProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<WidgetPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const locale = getInitialLocale();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !accountId) {
      setPhase(accountId ? "loading" : "error");
      return;
    }

    let active = true;
    let hideWidget: (() => void) | undefined;
    setPhase("loading");
    setError(null);
    host.replaceChildren();

    void (async () => {
      try {
        const statuses = await getYandexUnifiedAuthStatus(accountId);
        const communications = statuses.find((status) => status.id === "communications");
        if (!active) return;
        if (!communications?.connected) {
          setPhase("needs_access");
          return;
        }

        const token = await getYandexGrantAccessToken(accountId, "communications");
        if (!active) return;

        const ui = blockUIFactory();
        const widget = createMultiChatsWidget({
          serviceId: -1,
          authToken: `OAuth ${token}`,
        }).setUI(ui).init();
        ui.mount(host);
        widget.show();
        hideWidget = () => widget.hide();
        setPhase("ready");
      } catch (reason) {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (isMissingCommunicationsGrant(message)) {
          setPhase("needs_access");
          setError(null);
          return;
        }
        setError(message);
        setPhase("error");
      }
    })();

    return () => {
      active = false;
      hideWidget?.();
      host.replaceChildren();
    };
  }, [accountId, reloadToken]);

  const allowAccess = useCallback(async () => {
    if (!accountId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authorizeYandexGrant(accountId, "communications");
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, [accountId, busy]);

  if (!accountId) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-text-tertiary">
        {translateText("Select a connected Yandex account.", locale)}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 bg-bg-primary" data-testid="yandex-messenger-widget">
      <div
        ref={hostRef}
        className="h-full w-full"
        data-testid="yandex-messenger-widget-host"
        data-mounted={phase === "ready" ? "true" : "false"}
      />
      {phase === "loading" ? (
        <div className="absolute inset-0 grid place-items-center bg-bg-primary p-6 text-sm text-text-tertiary">
          {translateText("Loading...", locale)}
        </div>
      ) : null}
      {phase === "needs_access" ? (
        <div
          className="absolute inset-0 grid place-items-center bg-bg-primary p-6 text-center"
          data-testid="yandex-messenger-needs-access"
        >
          <div className="max-w-sm space-y-3">
            <p className="text-sm font-medium text-text-primary">
              {translateText("Messenger and Telemost need access for this account.", locale)}
            </p>
            <p className="text-xs text-text-tertiary">
              {translateText("Allow access through Yandex ID without showing technical labels.", locale)}
            </p>
            <button
              type="button"
              onClick={() => void allowAccess()}
              disabled={busy}
              className="rounded-xl border border-border-primary bg-bg-tertiary px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-hover disabled:opacity-50"
            >
              {translateText("Allow access", locale)}
            </button>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
          </div>
        </div>
      ) : null}
      {phase === "error" && error ? (
        <div className="absolute inset-0 grid place-items-center bg-bg-primary p-6 text-center text-sm text-danger">
          {error}
        </div>
      ) : null}
    </div>
  );
}
