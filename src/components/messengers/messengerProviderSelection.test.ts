import { describe, expect, it } from "vitest";
import {
  applyMessengerProviderTab,
  DEFAULT_MESSENGER_PROVIDER,
  MESSENGER_PROVIDER_TABS,
} from "./messengerProviderSelection";

describe("messengerProviderSelection", () => {
  it("defaults to MAX deterministically", () => {
    expect(DEFAULT_MESSENGER_PROVIDER).toBe("max");
    expect(MESSENGER_PROVIDER_TABS.map((tab) => tab.id)).toEqual(["max", "yandex", "telegram"]);
  });

  it("click MAX keeps MAX and clears conversation", () => {
    expect(applyMessengerProviderTab("max", ["max", "yandex"])).toEqual({
      selectedProviderId: "max",
      selectedConversationKey: null,
      activeProviderIds: ["max", "yandex"],
    });
  });

  it("click Yandex selects Yandex and clears conversation", () => {
    expect(applyMessengerProviderTab("yandex", ["max"])).toEqual({
      selectedProviderId: "yandex",
      selectedConversationKey: null,
      activeProviderIds: ["max", "yandex"],
    });
  });

  it("click Telegram selects Telegram", () => {
    expect(applyMessengerProviderTab("telegram", ["max", "yandex"]).selectedProviderId).toBe("telegram");
  });
});
