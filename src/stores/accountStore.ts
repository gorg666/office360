import { create } from "zustand";
import { setSetting } from "../services/db/settings";

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  provider?: string;
}

interface AccountState {
  accounts: Account[];
  activeAccountId: string | null;
  setAccounts: (accounts: Account[], restoredId?: string | null) => void;
  setActiveAccount: (id: string) => void;
  addAccount: (account: Account) => void;
  removeAccount: (id: string) => void;
}

export const useAccountStore = create<AccountState>((set) => ({
  accounts: [],
  activeAccountId: null,

  setAccounts: (accounts, restoredId) => {
    const activeId = (restoredId && accounts.some((a) => a.id === restoredId))
      ? restoredId
      : accounts[0]?.id ?? null;
    set({
      accounts: accounts.map((account) => ({
        ...account,
        isActive: account.id === activeId,
      })),
      activeAccountId: activeId,
    });
  },

  setActiveAccount: (activeAccountId) => {
    setSetting("active_account_id", activeAccountId).catch(() => {});
    set((state) => ({
      activeAccountId,
      accounts: state.accounts.map((account) => ({
        ...account,
        isActive: account.id === activeAccountId,
      })),
    }));
  },

  addAccount: (account) =>
    set((state) => {
      const activeAccountId = state.activeAccountId ?? account.id;
      return {
        accounts: [...state.accounts, account].map((item) => ({
          ...item,
          isActive: item.id === activeAccountId,
        })),
        activeAccountId,
      };
    }),

  removeAccount: (id) =>
    set((state) => {
      const accounts = state.accounts.filter((a) => a.id !== id);
      const activeAccountId =
        state.activeAccountId === id
          ? (accounts[0]?.id ?? null)
          : state.activeAccountId;
      return {
        accounts: accounts.map((account) => ({
          ...account,
          isActive: account.id === activeAccountId,
        })),
        activeAccountId,
      };
    }),
}));
