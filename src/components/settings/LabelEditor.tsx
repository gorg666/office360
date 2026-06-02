import { useState, useEffect, useCallback } from "react";
import { Trash2, Pencil, ChevronUp, ChevronDown, X } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useLabelStore, type Label } from "@/stores/labelStore";
import { LabelForm } from "@/components/labels/LabelForm";
import { getCapabilitiesForAccountProvider, getUnsupportedReason } from "@/services/email/providerCapabilities";

export function LabelEditor() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const { labels, loadLabels, deleteLabel, reorderLabels } = useLabelStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeAccountId) {
      loadLabels(activeAccountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadLabels is a stable store function, only re-run on activeAccountId change
  }, [activeAccountId]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setShowForm(false);
    setError(null);
  }, []);

  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const capabilities = getCapabilitiesForAccountProvider(activeAccount?.provider);
  const canCreateLabel = capabilities.labels.create.supported;
  const canRenameLabel = capabilities.labels.rename.supported;
  const canDeleteLabel = capabilities.labels.delete.supported;
  const createDisabledReason = getUnsupportedReason(capabilities.labels.create) ?? undefined;
  const renameDisabledReason = getUnsupportedReason(capabilities.labels.rename) ?? undefined;
  const deleteDisabledReason = getUnsupportedReason(capabilities.labels.delete) ?? undefined;

  const handleEdit = useCallback((label: Label) => {
    if (!canRenameLabel) return;
    setEditingId(label.id);
    setShowForm(true);
    setError(null);
  }, [canRenameLabel]);

  const handleDelete = useCallback(async (label: Label) => {
    if (!activeAccountId || !canDeleteLabel) return;
    setError(null);
    try {
      await deleteLabel(activeAccountId, label.id);
      if (editingId === label.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete label");
    }
  }, [activeAccountId, canDeleteLabel, deleteLabel, editingId, resetForm]);

  const handleMoveUp = useCallback(async (index: number) => {
    if (!activeAccountId || index === 0) return;
    const newOrder = labels.map((l) => l.id);
    const a = newOrder[index - 1]!;
    const b = newOrder[index]!;
    newOrder[index - 1] = b;
    newOrder[index] = a;
    await reorderLabels(activeAccountId, newOrder);
  }, [activeAccountId, labels, reorderLabels]);

  const handleMoveDown = useCallback(async (index: number) => {
    if (!activeAccountId || index >= labels.length - 1) return;
    const newOrder = labels.map((l) => l.id);
    const a = newOrder[index]!;
    const b = newOrder[index + 1]!;
    newOrder[index] = b;
    newOrder[index + 1] = a;
    await reorderLabels(activeAccountId, newOrder);
  }, [activeAccountId, labels, reorderLabels]);

  const editingLabel = editingId ? labels.find((l) => l.id === editingId) ?? null : null;

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-danger/10 text-danger text-xs rounded-md">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {labels.length === 0 && !showForm && (
        <p className="text-sm text-text-tertiary">No user labels</p>
      )}

      {labels.map((label, index) => (
        <div key={label.id}>
          <div className="flex items-center justify-between py-2 px-3 bg-bg-secondary rounded-md">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {label.colorBg ? (
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: label.colorBg }}
                />
              ) : (
                <span className="w-3 h-3 rounded-full shrink-0 bg-text-tertiary/30" />
              )}
              <span className="text-sm font-medium text-text-primary truncate">
                {label.name}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => handleMoveUp(index)}
                disabled={index === 0}
                className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move up"
              >
                <ChevronUp size={13} />
              </button>
              <button
                onClick={() => handleMoveDown(index)}
                disabled={index === labels.length - 1}
                className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move down"
              >
                <ChevronDown size={13} />
              </button>
              <button
                onClick={() => handleEdit(label)}
                disabled={!canRenameLabel}
                className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                title={canRenameLabel ? "Edit" : renameDisabledReason}
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => handleDelete(label)}
                disabled={!canDeleteLabel}
                className="p-1 text-text-tertiary hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed"
                title={canDeleteLabel ? "Delete" : deleteDisabledReason}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {/* Inline edit form under the label being edited */}
          {showForm && editingId === label.id && activeAccountId && (
            <div className="mt-1">
              <LabelForm
                accountId={activeAccountId}
                label={editingLabel}
                onDone={resetForm}
              />
            </div>
          )}
        </div>
      ))}

      {/* New label form at bottom */}
      {showForm && !editingId && activeAccountId ? (
        <LabelForm
          accountId={activeAccountId}
          onDone={resetForm}
        />
      ) : !showForm && (
        <button
          onClick={() => {
            if (!canCreateLabel) return;
            setShowForm(true);
            setEditingId(null);
            setError(null);
          }}
          disabled={!canCreateLabel}
          className="text-xs text-accent hover:text-accent-hover disabled:text-text-tertiary disabled:cursor-not-allowed"
          title={canCreateLabel ? "Add label" : createDisabledReason}
        >
          + Add label
        </button>
      )}
    </div>
  );
}
