"use client";
import { useEffect, useState } from "react";
import type { ChatContext } from "@bookmark-ai/types";
import { resolveComposerContext } from "@/lib/api";
export function ChatContextPreview({ context, accountId }: { context: ChatContext; accountId: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof resolveComposerContext>>["resolved"] | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); setResult(null); setError(null); void resolveComposerContext(context, accountId, controller.signal).then(value => { if (!controller.signal.aborted) setResult(value.resolved); }).catch(err => { if (!controller.signal.aborted) setError(err.message); }); return () => controller.abort(); }, [JSON.stringify(context), accountId]);
  return <div className="max-h-80 overflow-auto space-y-2 text-sm">{error ? <p role="alert">{error}</p> : !result ? <p role="status">Checking context…</p> : <><p>{result.sources.length} available sources. These are checked again when you send.</p>{result.unavailable.map(item => <p key={item.id} className="text-destructive">{item.reason}</p>)}<ul className="space-y-2">{result.sources.slice(0,100).map(source => <li key={source.id}><span className="font-medium">{source.title || source.url}</span><span className="block break-all text-xs text-muted-foreground">{source.url}</span></li>)}</ul>{result.sources.length > 100 && <p>{result.sources.length - 100} additional sources included.</p>}</>}</div>;
}
