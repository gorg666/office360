import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { RecurrenceWriteScope } from "@/services/calendar/domain";
import { defaultRecurrenceScope, type RecurrenceScopeChoice } from "./recurrenceEditScope";

interface RecurrenceScopeDialogProps {
  intent: "update" | "delete";
  choices: RecurrenceScopeChoice[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (scope: RecurrenceWriteScope) => void;
}

export function RecurrenceScopeDialog({ intent, choices, busy, onCancel, onConfirm }: RecurrenceScopeDialogProps) {
  const labelId = useId();
  const initial = defaultRecurrenceScope(choices);
  const [selected, setSelected] = useState<RecurrenceWriteScope | null>(initial);
  const destructive = intent === "delete";
  const enabledChoice = choices.find((choice) => choice.scope === selected && choice.enabled);

  useEffect(() => {
    setSelected(defaultRecurrenceScope(choices));
  }, [choices]);

  return (
    <Modal
      isOpen
      onClose={busy ? () => undefined : onCancel}
      title={destructive ? "Удалить повторяющееся событие" : "Изменить повторяющееся событие"}
      width="w-full max-w-md"
      zIndex="z-[60]"
    >
      <form
        data-testid="recurrence-scope-dialog"
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!enabledChoice || busy) return;
          onConfirm(enabledChoice.scope);
        }}
      >
        <fieldset className="space-y-2" disabled={busy}>
          <legend id={labelId} className="sr-only">Область изменения</legend>
          <div role="radiogroup" aria-labelledby={labelId} className="space-y-2">
            {choices.map((choice) => (
              <label
                key={choice.scope}
                className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${
                  selected === choice.scope ? "border-accent bg-accent/10" : "border-border-primary bg-bg-tertiary"
                } ${choice.enabled ? "" : "cursor-not-allowed opacity-50"}`}
              >
                <input
                  type="radio"
                  name="recurrence-scope"
                  value={choice.scope}
                  data-testid={`recurrence-scope-${choice.scope}`}
                  checked={selected === choice.scope}
                  disabled={!choice.enabled}
                  autoFocus={selected === choice.scope}
                  className="mt-1 accent-current"
                  onChange={() => setSelected(choice.scope)}
                />
                <span>
                  <span className="block text-sm font-medium text-text-primary">{choice.label}</span>
                  {choice.description ? (
                    <span className="mt-0.5 block text-xs text-text-secondary">{choice.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={busy}>Отмена</Button>
          <Button
            type="submit"
            variant={destructive ? "danger" : "primary"}
            size="md"
            disabled={busy || !enabledChoice}
          >
            {busy ? (destructive ? "Удаление…" : "Сохранение…") : (destructive ? "Удалить" : "Сохранить")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
