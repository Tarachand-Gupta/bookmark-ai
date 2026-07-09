"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

export type ResponseProps = {
  children: string;
  className?: string;
};

/**
 * Streamed-markdown message body. Local stand-in for the retired AI Elements
 * `response` registry component — a thin wrapper over Streamdown.
 */
export const Response = memo(function Response({ children, className }: ResponseProps) {
  return (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      // Citation links point at the user's own saved bookmarks — render real
      // anchors instead of Streamdown's confirm-before-open safety modal.
      linkSafety={{ enabled: false }}
    >
      {children}
    </Streamdown>
  );
});
