"use client";

import { useState } from "react";
import { Bookmark, Radio, Layers, Search, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LiveTabsDemo } from "@/components/marketing/live-tabs";
import { AiSetupCard } from "./ai-setup-card";
import { ExtensionStoreButton } from "./extension-cta";
import { BookmarksDemo, MeaningSearchDemo, SavedSessionsDemo } from "./onboarding-visuals";

interface Feature {
  id: string;
  navLabel: string;
  icon: React.ElementType;
  title: string;
  description: string;
  render: () => React.ReactNode;
}

// AI setup is first, per product decision: the user configures their provider
// before the tour of what the app does with it.
const FEATURES: Feature[] = [
  {
    id: "ai",
    navLabel: "AI setup",
    icon: Sparkles,
    title: "Set up your AI",
    description:
      "Connect an AI provider to power chat and answers over your library. OpenRouter is the quickest start — it has free models.",
    render: () => <AiSetupCard />,
  },
  {
    id: "bookmarks",
    navLabel: "Bookmarks",
    icon: Bookmark,
    title: "Save from any browser",
    description:
      "Install the extension and one click saves the page. Each save is read, categorized and tagged for you — no folders to maintain.",
    render: () => (
      <div className="space-y-4">
        <BookmarksDemo />
        <ExtensionStoreButton size="sm" />
      </div>
    ),
  },
  {
    id: "search",
    navLabel: "Search by meaning",
    icon: Search,
    title: "Find it by what it means",
    description:
      "Search blends keywords with meaning, so the right page surfaces even when you don't remember its exact words. Ask AI to get an answer with citations.",
    render: () => <MeaningSearchDemo />,
  },
  {
    id: "live",
    navLabel: "Live tabs",
    icon: Radio,
    title: "See open tabs across devices",
    description:
      "Opt in from the extension and your open windows mirror here live — jump to a tab from another device. Nothing is stored until you save it.",
    render: () => <LiveTabsDemo />,
  },
  {
    id: "sessions",
    navLabel: "Saved sessions",
    icon: Layers,
    title: "Snapshot a whole window",
    description:
      "Save every tab in a window as one session, then close them. Restore the whole window later, or open tabs one at a time.",
    render: () => <SavedSessionsDemo />,
  },
];

export interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * First-run feature tour. Left rail (vertical on desktop, horizontal strip on
 * mobile) selects a feature; the right pane shows its heading, a short
 * description and a small self-contained visual. The library page owns the
 * localStorage "seen" flag and mounts this.
 */
export function OnboardingDialog({ open, onOpenChange }: OnboardingDialogProps) {
  const [activeId, setActiveId] = useState<string>(FEATURES[0].id);
  const active = FEATURES.find((f) => f.id === activeId) ?? FEATURES[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogDescription className="sr-only">
          A quick tour of what Bookmark AI can do.
        </DialogDescription>
        <div className="flex max-h-[85vh] flex-col sm:flex-row">
          {/* Rail: vertical tab list (desktop) / horizontal strip (mobile). */}
          <nav
            aria-label="Feature tour"
            className="shrink-0 border-b bg-muted/30 p-3 sm:w-56 sm:border-r sm:border-b-0"
          >
            <DialogHeader className="px-2 pb-3 text-left">
              <DialogTitle className="text-base">Welcome to Bookmark AI</DialogTitle>
            </DialogHeader>
            <ul className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                const isActive = f.id === activeId;
                return (
                  <li key={f.id} className="shrink-0 sm:shrink">
                    <button
                      type="button"
                      onClick={() => setActiveId(f.id)}
                      className={cn(
                        "flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {f.navLabel}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Pane: heading + description + visual for the selected feature. */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <h3 className="text-lg font-semibold tracking-tight">{active.title}</h3>
              <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {active.description}
              </p>
              <div className="mt-5">{active.render()}</div>
            </div>
            <div className="flex items-center justify-end border-t px-6 py-3">
              <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                Get started
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
