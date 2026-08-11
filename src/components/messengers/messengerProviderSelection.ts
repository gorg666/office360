import type { MessengerProviderId } from "@/services/messengers/credentials";

export const MESSENGER_PROVIDER_TABS: Array<{ id: MessengerProviderId; label: string }> = [
  { id: "max", label: "MAX" },
  { id: "yandex", label: "Яндекс" },
  { id: "telegram", label: "Telegram" },
];

/** Default tab when opening messengers (deterministic). */
export const DEFAULT_MESSENGER_PROVIDER: MessengerProviderId = "max";

/**
 * Tab click must switch the selected provider panel (not only list filters).
 * Clears conversation selection so a MAX chat cannot force the provider back.
 */
export function applyMessengerProviderTab(
  providerId: MessengerProviderId,
  activeProviderIds: MessengerProviderId[],
): {
  selectedProviderId: MessengerProviderId;
  selectedConversationKey: null;
  activeProviderIds: MessengerProviderId[];
} {
  return {
    selectedProviderId: providerId,
    selectedConversationKey: null,
    activeProviderIds: activeProviderIds.includes(providerId)
      ? activeProviderIds
      : [...activeProviderIds, providerId],
  };
}
