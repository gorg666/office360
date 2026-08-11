import { useEffect, useRef, useState } from "react";
import { blockUIFactory, createMultiChatsWidget } from "yandex-messenger-widget";
import "yandex-messenger-widget/lib/ui/block.css";
import { getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";

interface YandexMessengerWidgetProps {
  accountId: string | null;
}

export function YandexMessengerWidget({ accountId }: YandexMessengerWidgetProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !accountId) return;
    let active = true;
    let hideWidget: (() => void) | undefined;

    void getYandexGrantAccessToken(accountId, "communications")
      .then((token) => {
        if (!active) return;
        const ui = blockUIFactory();
        const widget = createMultiChatsWidget({
          serviceId: -1,
          authToken: `OAuth ${token}`,
        }).setUI(ui).init();
        ui.mount(host);
        widget.show();
        hideWidget = () => widget.hide();
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));

    return () => {
      active = false;
      hideWidget?.();
      host.replaceChildren();
    };
  }, [accountId]);

  if (!accountId) {
    return <div className="grid h-full place-items-center p-6 text-sm text-text-tertiary">Выберите подключённый аккаунт Яндекс.</div>;
  }

  return <div className="relative h-full min-h-0 bg-bg-primary">
    <div ref={hostRef} className="h-full w-full"/>
    {error && <div className="absolute inset-0 grid place-items-center bg-bg-primary p-6 text-center text-sm text-danger">{error}</div>}
  </div>;
}
