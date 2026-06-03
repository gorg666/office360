import { create } from "zustand";
import {
  getSmartFolders,
  insertSmartFolder,
  updateSmartFolder as updateSmartFolderDb,
  deleteSmartFolder as deleteSmartFolderDb,
  type DbSmartFolder,
} from "@/services/db/smartFolders";
import { getSmartFolderUnreadCount } from "@/services/search/smartFolderQuery";
import { getDb } from "@/services/db/connection";

export interface SmartFolder {
  id: string;
  accountId: string | null;
  name: string;
  query: string;
  icon: string;
  color: string | null;
  isDefault: boolean;
  sortOrder: number;
  status: string;
  statusReason: string | null;
  statusUpdatedAt: number | null;
}

function mapDbFolder(db: DbSmartFolder): SmartFolder {
  return {
    id: db.id,
    accountId: db.account_id,
    name: db.name,
    query: db.query,
    icon: db.icon,
    color: db.color,
    isDefault: db.is_default === 1,
    sortOrder: db.sort_order,
    status: db.status ?? "ok",
    statusReason: db.status_reason ?? null,
    statusUpdatedAt: db.status_updated_at ?? null,
  };
}

interface SmartFolderState {
  folders: SmartFolder[];
  unreadCounts: Record<string, number>;
  isLoading: boolean;
  loadFolders: (accountId?: string) => Promise<void>;
  createFolder: (
    name: string,
    query: string,
    accountId?: string,
    icon?: string,
    color?: string,
  ) => Promise<string>;
  updateFolder: (
    id: string,
    updates: { name?: string; query?: string; icon?: string; color?: string; status?: string | null; statusReason?: string | null },
  ) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  refreshUnreadCounts: (accountId: string) => Promise<void>;
}

export const useSmartFolderStore = create<SmartFolderState>((set, get) => ({
  folders: [],
  unreadCounts: {},
  isLoading: false,

  loadFolders: async (accountId?: string) => {
    set({ isLoading: true });
    try {
      const dbFolders = await getSmartFolders(accountId);
      set({ folders: dbFolders.map(mapDbFolder) });
    } catch (err) {
      console.error("Failed to load smart folders:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  createFolder: async (name, query, accountId?, icon?, color?) => {
    const id = await insertSmartFolder({ name, query, accountId, icon, color });
    const { folders } = get();
    set({
      folders: [
        ...folders,
        {
          id,
          accountId: accountId ?? null,
          name,
          query,
          icon: icon ?? "Search",
          color: color ?? null,
          isDefault: false,
          sortOrder: folders.length,
          status: "ok",
          statusReason: null,
          statusUpdatedAt: null,
        },
      ],
    });
    return id;
  },

  updateFolder: async (id, updates) => {
    await updateSmartFolderDb(id, updates);
    const { folders } = get();
    set({
      folders: folders.map((f) =>
        f.id === id ? {
          ...f,
          ...updates,
          status: updates.status ?? f.status,
          statusReason: updates.statusReason === undefined ? f.statusReason : updates.statusReason,
          statusUpdatedAt: updates.statusReason === undefined ? f.statusUpdatedAt : Math.floor(Date.now() / 1000),
        } : f,
      ),
    });
  },

  deleteFolder: async (id) => {
    await deleteSmartFolderDb(id);
    const { folders, unreadCounts } = get();
    const newCounts = { ...unreadCounts };
    delete newCounts[id];
    set({
      folders: folders.filter((f) => f.id !== id),
      unreadCounts: newCounts,
    });
  },

  refreshUnreadCounts: async (accountId: string) => {
    const { folders } = get();
    const counts: Record<string, number> = {};

    try {
      const db = await getDb();
      for (const folder of folders) {
        try {
          const { sql, params } = getSmartFolderUnreadCount(
            folder.query,
            accountId,
          );
          const rows = await db.select<{ count: number }[]>(sql, params);
          counts[folder.id] = rows[0]?.count ?? 0;
        } catch {
          counts[folder.id] = 0;
        }
      }
      set({ unreadCounts: counts });
    } catch (err) {
      console.error("Failed to refresh smart folder unread counts:", err);
    }
  },
}));
