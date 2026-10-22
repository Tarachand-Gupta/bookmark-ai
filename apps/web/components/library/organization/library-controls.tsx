"use client";

import { Button } from "@/components/ui/button";

export function OrganizationLibraryControls({ selected, onSelectLoaded, onSelectAll, selectingAll, search }: {
  selected: boolean;
  onSelectLoaded: () => void; onSelectAll: () => void; selectingAll: boolean; search: boolean;
}) {
  if (!selected) return null;
  return <div className="mb-3 flex flex-wrap gap-2">
    <Button variant="ghost" size="sm" className="min-h-11 md:min-h-8" type="button" onClick={onSelectLoaded}>Select loaded items</Button>
    <Button variant="ghost" size="sm" className="min-h-11 md:min-h-8" type="button" disabled={selectingAll} onClick={onSelectAll}>{selectingAll ? "Preparing selection…" : search ? "Select ranked results…" : "Select all matching results…"}</Button>
  </div>;
}
