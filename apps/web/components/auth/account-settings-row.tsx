"use client";

import type { ElementType, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type AccountPanelState = {
  activePanel: string | null;
  onPanelChange: (panel: string | null) => void;
};

/** Quiet summaries first; only the selected account task exposes its controls. */
export function AccountSettingsRow({
  panel, title, description, icon: Icon, activePanel, onPanelChange, disabled, children,
}: AccountPanelState & {
  panel: string;
  title: string;
  description?: string;
  icon: ElementType;
  disabled?: boolean;
  children: ReactNode;
}) {
  const open = activePanel === panel;
  return (
    <Collapsible open={open} onOpenChange={next => onPanelChange(next ? panel : null)} className="border-b last:border-b-0">
      <CollapsibleTrigger disabled={disabled} className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          {description && <span className="block text-xs leading-5 text-muted-foreground">{description}</span>}
        </span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 border-t border-dashed px-3 py-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
