"use client";
import { useState } from "react";
import { Check, Monitor, Moon, Palette, Search, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useThemePreferences } from "./theme-preferences-provider";
import { THEME_PRESETS, themeTokens } from "@/lib/theme-picker/catalog";

/** Shared complete appearance controls for public navigation and Settings. */
export function ThemeChoices() {
  const { preference, ready, update } = useThemePreferences();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [search, setSearch] = useState("");
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  if (!ready) return <p className="text-sm text-muted-foreground">Loading appearance…</p>;
  const matches = THEME_PRESETS.filter((preset) => preset.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="flex min-h-0 flex-col gap-3">
        <div role="group" aria-label="Color mode" className="grid grid-cols-3 gap-1">
          {(
            [
              { value: "light", label: "Light", Icon: Sun },
              { value: "dark", label: "Dark", Icon: Moon },
              { value: "system", label: "System", Icon: Monitor },
            ] as const
          ).map(({ value, label, Icon }) => (
            <Button
              key={value}
              type="button"
              variant={theme === value ? "secondary" : "ghost"}
              className="h-11 px-2 text-xs"
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </Button>
          ))}
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"
          />
          <Input
            aria-label="Search themes"
            placeholder="Search themes…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 pl-9 text-base sm:text-sm"
          />
        </div>
        <div
          role="group"
          aria-label="Theme presets"
          className="min-h-0 max-h-72 overflow-y-auto overscroll-contain"
        >
          {matches.map(({ name, label }) => {
            const tokens = themeTokens(name, mode);
            return (
              <Button
                key={name}
                type="button"
                variant="ghost"
                className="h-11 w-full justify-start gap-3 px-2 text-sm"
                aria-pressed={preference.preset === name}
                onClick={() => update({ preset: name })}
              >
                <span aria-hidden className="flex shrink-0 -space-x-1">
                  {[tokens.primary, tokens.accent, tokens.background].map((color, index) => (
                    <span
                      key={index}
                      className="size-4 rounded-full border border-foreground/20"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <span className="flex-1 text-left">{label}</span>
                {preference.preset === name && <Check className="size-4 shrink-0" aria-hidden />}
              </Button>
            );
          })}
          {!matches.length && (
            <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">
              No themes found.
            </p>
          )}
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Tweakcn presets · Saved in this browser
        </p>
  </div>;
}

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Choose theme">
          <Palette className="size-[1.15rem]" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={8} collisionPadding={16}
        className="flex w-[min(20rem,calc(100vw-2rem))] max-h-[min(80dvh,var(--radix-popover-content-available-height))] flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between pl-1">
          <h2 className="text-sm font-semibold">Choose theme</h2>
          <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Close theme picker" onClick={() => setOpen(false)}><X className="size-4" aria-hidden /></Button>
        </div>
        {open && <ThemeChoices />}
      </PopoverContent>
    </Popover>
  );
}
