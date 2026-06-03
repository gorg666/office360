import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import ThreadWindow from "./ThreadWindow";
import ComposerWindow from "./ComposerWindow";
import { TranslationLayer } from "./components/i18n/TranslationLayer";
import { getInitialLocale } from "./i18n";
import { useUIStore } from "./stores/uiStore";
import "./styles/globals.css";

const QueueEpic03SmokeApp = lazy(() =>
  import("./dev/queueSmoke/QueueEpic03SmokeApp").then((module) => ({ default: module.QueueEpic03SmokeApp })),
);

const params = new URLSearchParams(window.location.search);
const isThreadWindow = params.has("thread") && params.has("account");
const isComposerWindow = params.has("compose");
const isQueueSmoke = import.meta.env.VITE_QUEUE_SMOKE === "1" || params.has("queueSmoke");
useUIStore.getState().restoreLocale(getInitialLocale());

function Root() {
  if (isQueueSmoke) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-text-tertiary">Loading queue smoke...</div>}>
        <QueueEpic03SmokeApp />
      </Suspense>
    );
  }
  if (isThreadWindow) return <ThreadWindow />;
  if (isComposerWindow) return <ComposerWindow />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TranslationLayer />
    <Root />
  </StrictMode>,
);
