import { createRouter, createHashHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree";

// Never restore the native CEF overlay before the React shell is ready.
if (window.location.hash.startsWith("#/telemost")) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/mail/inbox`);
}

const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: false,
});

// Type-safe router module augmentation
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
