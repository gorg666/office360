import { create } from "zustand";
import type { ComposerMode } from "./composerStore";

export type ComposeSendPhase =
  | "idle"
  | "queued"
  | "sending"
  | "smtp_accepted"
  | "sent_reconciling"
  | "sent"
  | "failed";

export interface ComposeSendRestore {
  mode: ComposerMode;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  threadId: string | null;
  inReplyToMessageId: string | null;
  draftId: string | null;
  fromEmail: string | null;
}

export interface ActiveComposeSend {
  requestId: string;
  accountId: string;
  rawBase64Url: string;
  threadId?: string;
  draftId?: string | null;
  restore: ComposeSendRestore;
  recipientEmails: string[];
  undoDelayMs: number;
  outboxOpId: string | null;
  phase: ComposeSendPhase;
  errorMessage: string | null;
}

interface SendStatusState {
  active: ActiveComposeSend | null;
  undoVisible: boolean;
  setActive: (active: ActiveComposeSend | null) => void;
  patchActive: (patch: Partial<ActiveComposeSend>) => void;
  setUndoVisible: (visible: boolean) => void;
  clear: () => void;
}

export const useSendStatusStore = create<SendStatusState>((set) => ({
  active: null,
  undoVisible: false,
  setActive: (active) => set({ active }),
  patchActive: (patch) =>
    set((state) => ({
      active: state.active ? { ...state.active, ...patch } : null,
    })),
  setUndoVisible: (undoVisible) => set({ undoVisible }),
  clear: () => set({ active: null, undoVisible: false }),
}));
