import { useCallback, useEffect, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { AddressInput } from "./AddressInput";
import { EditorToolbar } from "./EditorToolbar";
import { AiAssistPanel } from "./AiAssistPanel";
import { AttachmentPicker } from "./AttachmentPicker";
import { ScheduleSendDialog } from "./ScheduleSendDialog";
import { SignatureSelector } from "./SignatureSelector";
import { TemplatePicker } from "./TemplatePicker";
import { FromSelector } from "./FromSelector";
import { ComposerHeader } from "./ComposerHeader";
import { useComposerStore } from "@/stores/composerStore";
import { useAccountStore } from "@/stores/accountStore";
import { deleteDraft as deleteDraftAction } from "@/services/emailActions";
import { buildRawEmail } from "@/utils/emailBuilder";
import { buildReplyHeadersForMessageId } from "@/utils/replyHeaders";
import { getSetting } from "@/services/db/settings";
import { insertScheduledEmail } from "@/services/db/scheduledEmails";
import { getDefaultSignature } from "@/services/db/signatures";
import { getAliasesForAccount, mapDbAlias, type SendAsAlias } from "@/services/db/sendAsAliases";
import { getMessagesForThread, type DbMessage } from "@/services/db/messages";
import { resolveFromAddress } from "@/utils/resolveFromAddress";
import { openComposeWindow, isComposeStandaloneWindow, closeStandaloneComposeWindow } from "@/utils/openComposeWindow";
import { startAutoSave, stopAutoSave } from "@/services/composer/draftAutoSave";
import { requestComposeSend } from "@/services/composer/composeSendOrchestrator";
import { getTemplatesForAccount, type DbTemplate } from "@/services/db/templates";
import { readFileAsBase64 } from "@/utils/fileUtils";
import { interpolateVariables } from "@/utils/templateVariables";
import { sanitizeHtml } from "@/utils/sanitize";

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMessageForAiReply(message: DbMessage): string {
  const from = message.from_name
    ? `${message.from_name} <${message.from_address ?? ""}>`
    : (message.from_address ?? "Unknown");
  const date = new Date(message.date).toLocaleString("ru-RU");
  const body = (message.body_text ?? (message.body_html ? htmlToText(message.body_html) : message.snippet) ?? "").trim();
  return `From: ${from}\nDate: ${date}\nSubject: ${message.subject ?? ""}\n\n${body}`;
}

export function Composer() {
  // Individual selectors — only re-render when each specific value changes
  const isOpen = useComposerStore((s) => s.isOpen);
  const mode = useComposerStore((s) => s.mode);
  const to = useComposerStore((s) => s.to);
  const cc = useComposerStore((s) => s.cc);
  const bcc = useComposerStore((s) => s.bcc);
  const subject = useComposerStore((s) => s.subject);
  const threadId = useComposerStore((s) => s.threadId);
  const showCcBcc = useComposerStore((s) => s.showCcBcc);
  const fromEmail = useComposerStore((s) => s.fromEmail);
  const viewMode = useComposerStore((s) => s.viewMode);
  const signatureHtml = useComposerStore((s) => s.signatureHtml);
  const isSaving = useComposerStore((s) => s.isSaving);
  const lastSavedAt = useComposerStore((s) => s.lastSavedAt);
  // Note: bodyHtml intentionally NOT subscribed — TipTap manages its own editor state.
  // Subscribing would cause full re-renders on every keystroke.
  const closeComposer = useComposerStore((s) => s.closeComposer);
  const setTo = useComposerStore((s) => s.setTo);
  const setCc = useComposerStore((s) => s.setCc);
  const setBcc = useComposerStore((s) => s.setBcc);
  const setSubject = useComposerStore((s) => s.setSubject);
  const setShowCcBcc = useComposerStore((s) => s.setShowCcBcc);
  const setFromEmail = useComposerStore((s) => s.setFromEmail);
  const setViewMode = useComposerStore((s) => s.setViewMode);
  const addAttachment = useComposerStore((s) => s.addAttachment);

  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const sendingRef = useRef(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAiAssist, setShowAiAssist] = useState(false);
  const [replyThreadMessages, setReplyThreadMessages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [aliases, setAliases] = useState<SendAsAlias[]>([]);
  const templateShortcutsRef = useRef<DbTemplate[]>([]);
  const dragCounterRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      Placeholder.configure({
        placeholder: "Напишите сообщение...",
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: useComposerStore.getState().bodyHtml,
    onUpdate: ({ editor: ed }) => {
      useComposerStore.getState().setBodyHtml(ed.getHTML());

      // Check for template shortcut triggers
      const templates = templateShortcutsRef.current;
      if (templates.length === 0) return;

      const text = ed.state.doc.textContent;
      for (const tmpl of templates) {
        if (!tmpl.shortcut) continue;
        if (text.endsWith(tmpl.shortcut)) {
          // Delete the shortcut text and insert template body with variables resolved
          const { from } = ed.state.selection;
          const deleteFrom = from - tmpl.shortcut.length;
          if (deleteFrom >= 0) {
            const state = useComposerStore.getState();
            const account = useAccountStore.getState().accounts.find(
              (a) => a.id === useAccountStore.getState().activeAccountId,
            );
            interpolateVariables(tmpl.body_html, {
              recipientEmail: state.to[0],
              senderEmail: account?.email,
              senderName: account?.displayName ?? undefined,
              subject: state.subject || undefined,
            }).then((resolved) => {
              ed.chain()
                .deleteRange({ from: deleteFrom, to: from })
                .insertContent(resolved)
                .run();
            });
            if (tmpl.subject && !state.subject) {
              setSubject(tmpl.subject);
            }
          }
          break;
        }
      }
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none px-4 py-3 min-h-[200px] focus:outline-none text-text-primary",
      },
      handleDrop: (_view, event) => {
        // Prevent TipTap from handling file drops as inline content.
        // Returning true stops TipTap's Image extension from intercepting the drop,
        // allowing the event to bubble up to the composer's onDrop for attachment handling.
        if (event.dataTransfer?.files?.length) {
          return true;
        }
        return false;
      },
    },
  });

  const isReplyMode = mode === "reply" || mode === "replyAll";

  useEffect(() => {
    if (!showAiAssist || !isReplyMode || !activeAccountId || !threadId) {
      setReplyThreadMessages([]);
      return;
    }

    let cancelled = false;
    getMessagesForThread(activeAccountId, threadId)
      .then((messages) => {
        if (cancelled) return;
        setReplyThreadMessages(messages.map(formatMessageForAiReply));
      })
      .catch((err) => {
        console.error("Failed to load thread messages for AI reply:", err);
        if (!cancelled) setReplyThreadMessages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeAccountId, isReplyMode, showAiAssist, threadId]);

  // Load signature, aliases, and templates in parallel when composer opens
  useEffect(() => {
    if (!isOpen || !activeAccountId) return;
    let cancelled = false;

    Promise.all([
      getDefaultSignature(activeAccountId),
      getAliasesForAccount(activeAccountId),
      getTemplatesForAccount(activeAccountId),
    ]).then(([sig, dbAliases, templates]) => {
      if (cancelled) return;
      const store = useComposerStore.getState();

      // Signature
      if (sig) {
        store.setSignatureHtml(sig.body_html);
        store.setSignatureId(sig.id);
      }

      // Aliases + fromEmail resolution
      const mapped = dbAliases.map(mapDbAlias);
      setAliases(mapped);
      if (!store.fromEmail && mapped.length > 0) {
        if (store.mode === "reply" || store.mode === "replyAll" || store.mode === "forward") {
          const resolved = resolveFromAddress(mapped, store.to.join(", "), store.cc.join(", "));
          if (resolved) store.setFromEmail(resolved.email);
        } else {
          const defaultAlias = mapped.find((a) => a.isDefault) ?? mapped.find((a) => a.isPrimary) ?? mapped[0];
          if (defaultAlias) store.setFromEmail(defaultAlias.email);
        }
      }

      // Templates
      templateShortcutsRef.current = templates.filter((t) => t.shortcut);
    });

    return () => { cancelled = true; };
  }, [isOpen, activeAccountId]);

  // Start/stop draft auto-save
  useEffect(() => {
    if (!isOpen || !activeAccountId) return;
    startAutoSave(activeAccountId);
    return () => { stopAutoSave(); };
  }, [isOpen, activeAccountId]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const content = await readFileAsBase64(file);
      addAttachment({
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        content,
      });
    }
  }, [addAttachment]);

  const getFullHtml = useCallback(() => {
    const editorHtml = editor?.getHTML() ?? "";
    if (!signatureHtml) return editorHtml;
    return `${editorHtml}<div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:12px">${sanitizeHtml(signatureHtml)}</div>`;
  }, [editor, signatureHtml]);

  const handleSend = useCallback(async () => {
    if (!activeAccountId || !activeAccount || sendingRef.current) return;
    const state = useComposerStore.getState();
    if (state.to.length === 0) return;

    sendingRef.current = true;
    stopAutoSave();

    try {
      const html = getFullHtml();
      const senderEmail = state.fromEmail ?? activeAccount.email;
      const replyHeaders = await buildReplyHeadersForMessageId(activeAccountId, state.inReplyToMessageId);
      const raw = buildRawEmail({
        from: senderEmail,
        to: state.to,
        cc: state.cc.length > 0 ? state.cc : undefined,
        bcc: state.bcc.length > 0 ? state.bcc : undefined,
        subject: state.subject,
        htmlBody: html,
        inReplyTo: replyHeaders.inReplyTo,
        references: replyHeaders.references,
        threadId: state.threadId ?? undefined,
        attachments: state.attachments.length > 0
          ? state.attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              content: a.content,
            }))
          : undefined,
      });

      const delaySetting = await getSetting("undo_send_delay_seconds");
      const delay = parseInt(delaySetting ?? "5", 10) * 1000;

      await requestComposeSend({
        accountId: activeAccountId,
        rawBase64Url: raw,
        threadId: state.threadId ?? undefined,
        draftId: state.draftId,
        recipientEmails: [...state.to, ...state.cc, ...state.bcc],
        undoDelayMs: Number.isFinite(delay) ? delay : 5000,
        restore: {
          mode: state.mode,
          to: state.to,
          cc: state.cc,
          bcc: state.bcc,
          subject: state.subject,
          bodyHtml: html,
          threadId: state.threadId,
          inReplyToMessageId: state.inReplyToMessageId,
          draftId: state.draftId,
          fromEmail: state.fromEmail,
        },
      });

      closeComposer();
      await closeStandaloneComposeWindow();
    } catch (err) {
      console.error("Failed to queue compose send:", err);
      startAutoSave(activeAccountId);
    } finally {
      sendingRef.current = false;
    }
  }, [activeAccountId, activeAccount, closeComposer, getFullHtml]);

  const handleSchedule = useCallback(async (scheduledAt: number) => {
    if (!activeAccountId || !activeAccount) return;
    const state = useComposerStore.getState();
    if (state.to.length === 0) return;

    const html = getFullHtml();

    const attachmentData = state.attachments.length > 0
      ? JSON.stringify(state.attachments.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          content: a.content,
        })))
      : null;

    await insertScheduledEmail({
      accountId: activeAccountId,
      toAddresses: state.to.join(", "),
      ccAddresses: state.cc.length > 0 ? state.cc.join(", ") : null,
      bccAddresses: state.bcc.length > 0 ? state.bcc.join(", ") : null,
      subject: state.subject,
      bodyHtml: html,
      replyToMessageId: state.inReplyToMessageId,
      threadId: state.threadId,
      scheduledAt,
      signatureId: null,
    });

    // Store attachment data if present
    if (attachmentData) {
      // The insertScheduledEmail doesn't have an attachmentPaths param,
      // so we update it separately via the existing column
      const { getDb } = await import("@/services/db/connection");
      const db = await getDb();
      // Get the most recently inserted scheduled email for this account
      const rows = await db.select<{ id: string }[]>(
        "SELECT id FROM scheduled_emails WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1",
        [activeAccountId],
      );
      if (rows[0]) {
        await db.execute(
          "UPDATE scheduled_emails SET attachment_paths = $1 WHERE id = $2",
          [attachmentData, rows[0].id],
        );
      }
    }

    stopAutoSave();
    // Delete the draft if exists
    if (state.draftId) {
      try {
        await deleteDraftAction(activeAccountId, state.draftId);
      } catch { /* ignore */ }
    }

    setShowSchedule(false);
    closeComposer();
    await closeStandaloneComposeWindow();
  }, [activeAccountId, activeAccount, closeComposer, getFullHtml]);

  const handleDiscard = useCallback(async () => {
    stopAutoSave();
    // Delete the draft if it was saved
    const currentDraftId = useComposerStore.getState().draftId;
    if (currentDraftId && activeAccountId) {
      try {
        await deleteDraftAction(activeAccountId, currentDraftId);
      } catch { /* ignore */ }
    }
    closeComposer();
    await closeStandaloneComposeWindow();
  }, [activeAccountId, closeComposer]);

  const handlePopOutComposer = useCallback(async () => {
    const state = useComposerStore.getState();
    const bodyHtml = editor?.getHTML() ?? state.bodyHtml;
    const result = await openComposeWindow({
      mode: state.mode,
      to: state.to,
      cc: state.cc,
      bcc: state.bcc,
      subject: state.subject,
      bodyHtml,
      threadId: state.threadId,
      inReplyToMessageId: state.inReplyToMessageId,
      draftId: state.draftId,
      fromEmail: state.fromEmail,
      title: state.subject || undefined,
    });

    if (result !== "fallback") {
      stopAutoSave();
      closeComposer();
    }
  }, [editor, closeComposer]);

  const isStandalone = isComposeStandaloneWindow();

  const handleCloseStandalone = useCallback(async () => {
    stopAutoSave();
    closeComposer();
    await closeStandaloneComposeWindow();
  }, [closeComposer]);

  const isFullpage = viewMode === "fullpage";

  const modeLabel =
    mode === "reply"
      ? "Ответ"
      : mode === "replyAll"
        ? "Ответить всем"
        : mode === "forward"
          ? "Переслать"
          : "Новое сообщение";

  const savedLabel = isSaving
    ? "Сохранение черновика…"
    : lastSavedAt
      ? "Черновик сохранён"
      : null;

  return (
    <CSSTransition nodeRef={overlayRef} in={isOpen} timeout={200} classNames="slide-up" unmountOnExit>
    <div ref={overlayRef} className={`fixed inset-0 z-50 flex ${isFullpage ? "items-stretch justify-center" : "items-end justify-center pb-4"} ${isFullpage && !isStandalone ? "p-4" : ""} pointer-events-none`}>
      {/* No fullscreen dim/blur layer: avoids “disabled app” look while clicks pass through to the main UI */}

      {/* Composer window */}
      <div
        className={`relative bg-bg-primary glass-modal pointer-events-auto flex flex-col slide-up-panel ${
          isStandalone
            ? "w-full h-full border-0 rounded-none"
            : isFullpage
              ? "w-full h-full max-w-5xl border rounded-lg"
              : "w-full max-w-2xl max-h-[80vh] border rounded-lg"
        } ${isDragging ? "border-accent border-2" : isStandalone ? "" : "border-border-primary"}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-accent/10 rounded-lg pointer-events-none">
            <span className="text-sm font-medium text-accent">Перетащите файлы, чтобы прикрепить</span>
          </div>
        )}

        <ComposerHeader
          modeLabel={modeLabel}
          isFullpage={isFullpage}
          onToggleViewMode={() => setViewMode(isFullpage ? "modal" : "fullpage")}
          onPopOut={handlePopOutComposer}
          onCloseEmbedded={closeComposer}
          onCloseStandalone={() => void handleCloseStandalone()}
        />

        {/* Address fields */}
        <div className="px-3 py-2 space-y-1.5 border-b border-border-secondary">
          <FromSelector
            aliases={aliases}
            selectedEmail={fromEmail ?? activeAccount?.email ?? ""}
            onChange={(alias) => setFromEmail(alias.email)}
          />
          <AddressInput label="Кому" addresses={to} onChange={setTo} />
          {showCcBcc ? (
            <>
              <AddressInput label="Копия" addresses={cc} onChange={setCc} />
              <AddressInput label="Скрытая копия" addresses={bcc} onChange={setBcc} />
            </>
          ) : (
            <button
              onClick={() => setShowCcBcc(true)}
              className="text-xs text-accent hover:text-accent-hover ml-10"
            >
              Копия / Скрытая копия
            </button>
          )}
        </div>

        {/* Subject */}
        <div className="px-3 py-1.5 border-b border-border-secondary">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary w-8 shrink-0">
              Тема
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Тема"
              className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
        </div>

        {/* Editor toolbar */}
        <EditorToolbar
          editor={editor}
          onToggleAiAssist={() => setShowAiAssist(!showAiAssist)}
          aiAssistOpen={showAiAssist}
        />

        {/* AI Assist Panel */}
        {showAiAssist && (
          <AiAssistPanel
            editor={editor}
            isReplyMode={isReplyMode}
            threadMessages={replyThreadMessages}
          />
        )}

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
          {signatureHtml && (
            <div
              className="px-4 py-2 border-t border-border-secondary text-xs text-text-tertiary"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(signatureHtml) }}
            />
          )}
        </div>

        {/* Attachments */}
        <div className="border-t border-border-secondary">
          <AttachmentPicker />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-primary bg-bg-secondary rounded-b-lg">
          <div className="flex items-center gap-3">
            <div className="text-xs text-text-tertiary">
              {fromEmail ?? activeAccount?.email ?? "Нет аккаунта"}
            </div>
            {savedLabel && (
              <span className={`text-xs text-text-tertiary italic transition-opacity duration-200 ${isSaving ? "animate-pulse" : ""}`}>
                {savedLabel}
              </span>
            )}
            <SignatureSelector />
            <TemplatePicker editor={editor} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleDiscard}
            >
              Отменить
            </Button>
            <div className="flex items-center">
              <button
                onClick={handleSend}
                disabled={to.length === 0}
                className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-l-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Отправить
              </button>
              <button
                onClick={() => setShowSchedule(true)}
                disabled={to.length === 0}
                className="px-2 py-1.5 text-white bg-accent hover:bg-accent-hover border-l border-white/20 rounded-r-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Запланировать отправку"
              >
                <Clock size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSchedule && (
        <ScheduleSendDialog
          onSchedule={handleSchedule}
          onClose={() => setShowSchedule(false)}
        />
      )}
    </div>
    </CSSTransition>
  );
}
