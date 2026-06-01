import type { Editor } from "@tiptap/react";
import { ClipboardPaste, Copy, Redo2, Scissors, Undo2 } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { useContextMenuStore } from "@/stores/contextMenuStore";

function getEditorSelectionText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, "\n");
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function readClipboardText(): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null;

  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export function ComposerEditorContextMenu({
  position,
  data,
  onClose,
}: {
  position: { x: number; y: number };
  data: Record<string, unknown>;
  onClose: () => void;
}) {
  const editor = data["editor"] as Editor | undefined;

  if (!editor) {
    return <ContextMenu items={[]} position={position} onClose={onClose} />;
  }

  const hasSelection = !editor.state.selection.empty;

  const copySelection = async () => {
    editor.commands.focus();
    if (document.execCommand("copy")) return;
    await writeClipboardText(getEditorSelectionText(editor));
  };

  const cutSelection = async () => {
    editor.commands.focus();
    if (document.execCommand("cut")) return;
    if (await writeClipboardText(getEditorSelectionText(editor))) {
      editor.chain().focus().deleteSelection().run();
    }
  };

  const pasteText = async () => {
    editor.commands.focus();
    const text = await readClipboardText();
    if (text != null) {
      editor.chain().focus().insertContent(text).run();
      return;
    }
    document.execCommand("paste");
  };

  const items: ContextMenuItem[] = [
    {
      id: "undo",
      label: "Отменить",
      icon: Undo2,
      action: () => editor.chain().focus().undo().run(),
    },
    {
      id: "redo",
      label: "Повторить",
      icon: Redo2,
      action: () => editor.chain().focus().redo().run(),
    },
    { id: "sep-edit-history", label: "", separator: true },
    {
      id: "cut",
      label: "Вырезать",
      icon: Scissors,
      disabled: !hasSelection,
      action: cutSelection,
    },
    {
      id: "copy",
      label: "Копировать",
      icon: Copy,
      disabled: !hasSelection,
      action: copySelection,
    },
    {
      id: "paste",
      label: "Вставить",
      icon: ClipboardPaste,
      action: pasteText,
    },
    { id: "sep-select", label: "", separator: true },
    {
      id: "select-all",
      label: "Выделить всё",
      action: () => editor.chain().focus().selectAll().run(),
    },
  ];

  return <ContextMenu items={items} position={position} onClose={onClose} />;
}

export function ComposerEditorContextMenuPortal() {
  const menuType = useContextMenuStore((s) => s.menuType);
  const position = useContextMenuStore((s) => s.position);
  const data = useContextMenuStore((s) => s.data);
  const closeMenu = useContextMenuStore((s) => s.closeMenu);

  if (menuType !== "composerEditor") return null;

  return (
    <ComposerEditorContextMenu
      position={position}
      data={data}
      onClose={closeMenu}
    />
  );
}
