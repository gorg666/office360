import { useEffect } from "react";

export function useSuppressBrowserContextMenu() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-native-context-menu]")) return;
      e.preventDefault();
    };

    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);
}
