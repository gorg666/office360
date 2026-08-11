import { useState, useRef, useCallback, useEffect } from "react";
import { searchRecipientSuggestions, type RecipientSuggestion } from "@/services/db/contacts";

interface AddressInputProps {
  label: string;
  addresses: string[];
  onChange: (addresses: string[]) => void;
  placeholder?: string;
}

function contactInitials(contact: DbContact): string {
  const source = (contact.display_name ?? contact.email).trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return (source[0] ?? "?").toUpperCase();
}

export function AddressInput({
  label,
  addresses,
  onChange,
  placeholder = "Добавьте получателей...",
}: AddressInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const showRecentSuggestions = useCallback(async () => {
    const results = await getRecentContacts(5);
    const filtered = results.filter((c) => !addresses.includes(c.email));
    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
    setSelectedIdx(-1);
  }, [addresses]);

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (value.trim().length === 0) {
        void showRecentSuggestions();
        return;
      }
      if (value.length >= 2) {
        searchTimerRef.current = setTimeout(async () => {
          const results = await searchRecipientSuggestions(value, 8);
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
          setSelectedIdx(-1);
        }, 200);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    },
    [addresses, showRecentSuggestions],
  );

  const addAddress = useCallback(
    (address: string) => {
      const trimmed = address.trim();
      if (trimmed && !addresses.includes(trimmed)) {
        onChange([...addresses, trimmed]);
      }
      setInputValue("");
      setSuggestions([]);
      setShowSuggestions(false);
      inputRef.current?.focus();
    },
    [addresses, onChange],
  );

  const removeAddress = useCallback(
    (index: number) => {
      onChange(addresses.filter((_, i) => i !== index));
    },
    [addresses, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      e.preventDefault();
      if (showSuggestions && selectedIdx >= 0) {
        addAddress(suggestions[selectedIdx]!.address);
      } else if (inputValue.trim()) {
        addAddress(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && addresses.length > 0) {
      removeAddress(addresses.length - 1);
    } else if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && showSuggestions) {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-text-tertiary pt-1.5 w-14 shrink-0">
        {label}
      </span>
      <div className="flex-1 flex flex-wrap items-center gap-1 min-h-[32px] relative">
        {addresses.map((addr) => (
          <span
            key={addr}
            className="inline-flex items-center gap-1 bg-accent-light text-accent text-xs px-2 py-0.5 rounded-full"
          >
            {addr}
            <button
              onClick={() => onChange(addresses.filter((a) => a !== addr))}
              className="hover:text-danger text-[0.625rem] leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!inputValue.trim()) {
              void showRecentSuggestions();
            }
          }}
          onBlur={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            blurTimerRef.current = setTimeout(() => setShowSuggestions(false), 150);
            if (inputValue.trim()) addAddress(inputValue);
          }}
          placeholder={addresses.length === 0 ? placeholder : ""}
          aria-label={label}
          autoComplete="off"
          className="flex-1 min-w-[120px] bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
        />

        {showSuggestions && (
          <div
            role="listbox"
            className="absolute top-full left-0 mt-1 w-full bg-bg-primary border border-border-primary rounded-md shadow-lg z-50 py-1"
          >
            {suggestions.map((contact, i) => (
              <button
                key={`${contact.kind}:${contact.id}:${contact.address}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addAddress(contact.address)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-bg-hover ${
                  i === selectedIdx ? "bg-bg-hover" : ""
                }`}
              >
                <div className="text-text-primary">
                  {contact.label}
                </div>
                {(contact.detail || contact.address) && (
                  <div className="text-xs text-text-tertiary">
                    {contact.kind === "list" ? `List - ${contact.detail}` : contact.address}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
