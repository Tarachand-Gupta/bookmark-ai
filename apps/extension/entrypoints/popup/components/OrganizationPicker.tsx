import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "./ui/button";
export const fieldClass =
  "w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
export type PickerOption = { value: string; label: string };

/** Searchable custom listbox. In-flow placement keeps a toolbar popup's menu
 * within its own scroll viewport; arrows/typeahead never invoke an OS select. */
export function OrganizationPicker({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const selected = options.find((option) => option.value === value);
  function close() {
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  }
  function choose(index: number) {
    if (filtered[index]) onChange(filtered[index].value);
    close();
  }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? filtered.length - 1
            : Math.max(
                0,
                Math.min(filtered.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)),
              );
      setActive(next);
      document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }
  return (
    <div
      className="min-w-0 space-y-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span id={`${id}-label`} className="text-xs font-medium">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => {
          setOpen(!open);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            setActive(0);
          }
        }}
        className={`${fieldClass} flex items-center justify-between gap-2 text-start`}
      >
        <span id={`${id}-value`} className="truncate" title={selected?.label}>
          {selected?.label ?? (value ? "Unavailable — choose a replacement" : "Choose…")}
        </span>
        <span aria-hidden>⌄</span>
      </button>
      {open && (
        <div className="rounded-md border border-border bg-popover p-1 shadow-md">
          <input
            autoFocus
            role="combobox"
            aria-label={`Search ${label}`}
            aria-controls={`${id}-list`}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}
            className={fieldClass}
            value={query}
            placeholder={`Search ${label.toLowerCase()}…`}
            onKeyDown={key}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <div
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="max-h-36 overflow-y-auto overscroll-contain"
          >
            {filtered.map((option, index) => (
              <div
                role="option"
                aria-selected={option.value === value}
                id={`${id}-${index}`}
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                onMouseMove={() => setActive(index)}
                title={option.label}
                className={`cursor-pointer break-words rounded-sm px-2 py-2 text-xs ${index === active ? "bg-accent text-accent-foreground" : ""}`}
              >
                {option.value === value ? "✓ " : ""}
                {option.label}
              </div>
            ))}
            {!filtered.length && <p className="p-2 text-xs text-muted-foreground">No matches</p>}
          </div>
          <Button variant="ghost" onClick={close}>
            Close picker
          </Button>
        </div>
      )}
    </div>
  );
}
