"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ChatResponseActions({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="not-prose flex items-center gap-1 text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs"
        aria-label={copied ? "Response copied" : "Copy response"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setFailed(false);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      {onRetry && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={onRetry}
        >
          <RotateCw className="size-3.5" />
          Retry
        </Button>
      )}
      <span role="status" className={failed ? "text-xs" : "sr-only"}>
        {failed
          ? "Couldn’t copy. Select the response to copy it."
          : copied
            ? "Response copied"
            : ""}
      </span>
    </div>
  );
}
