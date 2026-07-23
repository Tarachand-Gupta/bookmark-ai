import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A single ghost turn: a right-aligned user bubble or a left-aligned assistant
 * block (wider, multi-line — assistant answers run longer). */
function GhostTurn({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <Skeleton className="h-8 w-2/5 rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="w-full space-y-2">
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

/**
 * Placeholder shown while a stored conversation loads (the GET + setMessages can
 * take a few seconds for tool-heavy threads). Alternating user/assistant ghost
 * bubbles read as "a conversation is arriving" rather than a broken empty panel.
 */
export function ChatThreadSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-5", className)} aria-hidden>
      <GhostTurn role="user" />
      <GhostTurn role="assistant" />
      <GhostTurn role="user" />
      <GhostTurn role="assistant" />
      <span className="sr-only">Loading conversation…</span>
    </div>
  );
}
