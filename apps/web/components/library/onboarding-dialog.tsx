"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FEATURE_ICONS } from "./feature-icons";
import { AiSetupCard } from "./ai-setup-card";
import { ExtensionStoreButton } from "./extension-cta";
import { TourStage, TourSteps } from "./onboarding-visuals";
// The tour reuses the SAME landing-page animations, not static screenshots or a
// hand-rolled demo — one source of truth for "how it works". Each mock gates
// its own motion behind prefers-reduced-motion and settles on its *finished*
// frame, so nothing extra is needed here for that.
import { SaveBookmarkMock, SearchDemo, SessionMock } from "@bookmark-ai/ui/demos/feature-mocks";
import { LiveTabsDemo } from "@bookmark-ai/ui/demos/live-tabs-demo";

interface Feature {
  id: string;
  navLabel: string;
  icon: React.ElementType;
  title: string;
  description: string;
  render: () => React.ReactNode;
}

// Tour order (rail + Next/Back advance): AI → Bookmarks → Saved sessions →
// Live tabs → Search by meaning. AI leads because it's the answer to "do I have
// to set anything up?" — no — and the rest of the tour is what it works on.
const FEATURES: Feature[] = [
  {
    id: "ai",
    navLabel: "AI",
    icon: FEATURE_ICONS.ai,
    title: "AI is included, free",
    // This step used to be titled "Set up your AI" over a provider/key form,
    // which told a brand-new account that AI needs configuring. It doesn't:
    // every account gets free weekly credits on the shared AI, and bringing your
    // own key is the optional second path (collapsed inside the card below).
    description:
      "Chat and answers run on our shared AI, with free credits every week — nothing to set up. You can plug in your own provider key any time instead.",
    render: () => <AiSetupCard />,
  },
  {
    id: "bookmarks",
    navLabel: "Bookmarks",
    icon: FEATURE_ICONS.bookmarks,
    title: "Save from any browser",
    description:
      "Install the extension, then one click saves the page — read, categorized and tagged for you, with no folders to maintain.",
    render: () => (
      <div className="space-y-4">
        <ExtensionStoreButton size="sm" />
        <div>
          <p className="mb-2 text-xs font-medium text-foreground">How saving works</p>
          <TourSteps
            steps={[
              <>Click the extension icon on any page</>,
              <>
                <strong>Save bookmark</strong> — title, icon and link are grabbed for you
              </>,
              <>It lands here, categorized and tagged</>,
            ]}
          />
        </div>
        <TourStage>
          <SaveBookmarkMock />
        </TourStage>
      </div>
    ),
  },
  {
    id: "sessions",
    navLabel: "Saved sessions",
    icon: FEATURE_ICONS.sessions,
    title: "Snapshot a whole window",
    description:
      "A saved session is every tab in a window captured as one snapshot — close them now, bring them all back later.",
    render: () => (
      <div className="space-y-4">
        <TourSteps
          steps={[
            <>
              From the extension popup, <strong>save a whole window</strong> as one session
            </>,
            <>
              Restore it later as a new <strong>window</strong> — or as a <strong>tab group</strong>
            </>,
          ]}
        />
        <TourStage>
          <SessionMock />
        </TourStage>
      </div>
    ),
  },
  {
    id: "live",
    navLabel: "Live tabs",
    icon: FEATURE_ICONS.live,
    title: "See open tabs across devices",
    description:
      "Mirror a window's open tabs here in real time, so you can jump to a tab that's open on another device.",
    render: () => (
      <div className="space-y-4">
        <TourSteps
          steps={[
            <>
              In the extension popup, flip <strong>Share window as live session</strong>
            </>,
            <>Name this device so you recognize it</>,
            <>
              Open <strong>Live sessions</strong> here — or on your phone — and your windows appear
              live, with a green <strong>LIVE</strong> dot; jump to any tab or Save a window as a
              session
            </>,
          ]}
        />
        <TourStage>
          {/* Zeroes the marketing card's baked-in `mt-6` — the tour stage
              supplies its own spacing via TourStage's padding. */}
          <LiveTabsDemo className="mt-0" />
        </TourStage>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Opt-in only. Private windows are never sent, and a live session disappears after 7 days.
        </p>
      </div>
    ),
  },
  {
    id: "search",
    navLabel: "Search by meaning",
    icon: FEATURE_ICONS.search,
    title: "Find it by what it means",
    description:
      "Search blends keywords with meaning, so the right page surfaces even when you don't remember its exact words. Ask AI to get an answer with citations.",
    render: () => (
      <TourStage>
        {/* Zeroes the marketing card's baked-in `mt-6` — the tour stage
            supplies its own spacing via TourStage's padding. */}
        <SearchDemo className="mt-0" />
      </TourStage>
    ),
  },
];

export interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * First-run product tour. A left rail (vertical on desktop, horizontal strip on
 * mobile) lists the steps and jumps straight to any of them; the footer is a
 * stepper (Back / Next, "Get started" on the last step) plus a quiet "Skip tour"
 * that closes from anywhere. The library page owns the localStorage "seen" flag
 * and mounts this — closing (skip, get started, or dismiss) persists it.
 */
export function OnboardingDialog({ open, onOpenChange }: OnboardingDialogProps) {
  const [index, setIndex] = useState(0);
  const active = FEATURES[index];
  const isFirst = index === 0;
  const isLast = index === FEATURES.length - 1;

  const railRef = useRef<HTMLUListElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Keep the active tab in view on narrow screens (the strip scrolls
  // horizontally) and reset the content scroll to the top when stepping.
  useEffect(() => {
    railRef.current
      ?.querySelector<HTMLElement>('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    contentRef.current?.scrollTo({ top: 0 });
  }, [index]);

  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:w-full sm:max-w-3xl">
        <DialogDescription className="sr-only">
          A quick tour of what Bookmark AI can do.
        </DialogDescription>
        <div className="flex max-h-[85dvh] min-w-0 flex-col sm:flex-row">
          {/* Rail: vertical tab list (desktop) / horizontal strip (mobile). */}
          <nav
            aria-label="Product tour"
            className="min-w-0 shrink-0 border-b bg-muted/30 p-3 sm:w-56 sm:border-r sm:border-b-0"
          >
            <DialogHeader className="px-2 pb-3 text-left">
              <span className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Product tour
              </span>
              <DialogTitle className="text-base font-semibold">
                Welcome to{" "}
                <span className="whitespace-nowrap">Bookmark AI</span>
              </DialogTitle>
            </DialogHeader>
            <ul
              ref={railRef}
              style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
              className="flex touch-pan-x scroll-smooth gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden sm:flex-col sm:overflow-visible"
            >
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                const isActive = i === index;
                return (
                  <li key={f.id} className="shrink-0 sm:shrink">
                    <button
                      type="button"
                      onClick={() => setIndex(i)}
                      aria-current={isActive ? "step" : undefined}
                      className={cn(
                        "cursor-pointer flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        // Same active treatment as the Settings dialog's rail
                        // (bg-primary/text-primary-foreground) — this rail is a
                        // copy of that one, and `bg-accent` was too close to the
                        // nav's own bg-muted/30 in dark mode to tell the current
                        // step apart from the rest.
                        isActive
                          ? "bg-primary font-medium text-primary-foreground"
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

          {/* Pane: heading + description + content for the selected step. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto break-words p-6">
              <h3 className="text-lg font-semibold tracking-tight">{active.title}</h3>
              <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {active.description}
              </p>
              <div className="mt-5">{active.render()}</div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-6 py-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={close}
              >
                Skip tour
              </Button>
              <div className="flex items-center gap-2">
                {!isFirst && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  >
                    Back
                  </Button>
                )}
                {isLast ? (
                  <Button type="button" size="sm" onClick={close}>
                    Get started
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setIndex((i) => Math.min(FEATURES.length - 1, i + 1))}
                  >
                    Next
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
