import { useRef } from "react";
import { PeoplePicker, type PeopleSearch } from "@/components/people/PeoplePicker";
import { normalizePersonEmail, personIdentityFromEmail, type PersonIdentity } from "@/services/people";

interface AddressInputProps {
  label: string;
  addresses: string[];
  onChange: (addresses: string[]) => void;
  accountId?: string | null;
  placeholder?: string;
  search?: PeopleSearch;
}

export function AddressInput({
  label,
  addresses,
  onChange,
  accountId,
  placeholder = "Добавьте получателей...",
  search,
}: AddressInputProps) {
  const identityCache = useRef(new Map<string, PersonIdentity>());
  const selected = addresses.map((email) => (
    identityCache.current.get(normalizePersonEmail(email)) ?? personIdentityFromEmail(email)
  ));

  const handleChange = (people: PersonIdentity[]) => {
    for (const person of people) identityCache.current.set(person.normalizedEmail, person);
    onChange(people.map((person) => person.email));
  };

  return (
    <div className="flex items-start gap-2">
      <span className="w-14 shrink-0 pt-2 text-xs text-text-tertiary">{label}</span>
      <PeoplePicker
        accountId={accountId}
        label={label}
        selected={selected}
        onChange={handleChange}
        placeholder={placeholder}
        className="min-w-0 flex-1"
        {...(search ? { search } : {})}
      />
    </div>
  );
}
