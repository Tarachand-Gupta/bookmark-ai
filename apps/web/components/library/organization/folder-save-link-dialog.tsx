"use client";
import { useEffect, useRef, useState } from "react";
import type { Bookmark, CreateBookmarkInput, OrganizationFolder } from "@bookmark-ai/types";
import { createBookmarkSchema } from "@bookmark-ai/types";
import { useAuth } from "@/lib/auth";
import { createBookmark } from "@/lib/api";
import { detectSource } from "@/lib/detect";
import { onExplicitSignOut } from "@/lib/account-private-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Save uses the existing idempotent API; filing is a separate, explicit BulkEditor confirmation.
 * Duplicate saves never silently move an existing bookmark or overwrite its labels. */
export function FolderSaveLinkDialog({ folder, onClose, onSaved }: { folder: OrganizationFolder; onClose: () => void; onSaved: (bookmark: Bookmark) => void }) {
  const { userId } = useAuth();
  const account = useRef(userId); account.current = userId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const request = useRef<CreateBookmarkInput | null>(null);
  // Share the normal Save dialog's pending request, so recovery cannot create a competing save.
  const storageKey = `bmai:save-request:v1:${userId}`;
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (stored?.accountId === userId && stored.input?.operationId) {
        const parsed = createBookmarkSchema.safeParse(stored.input);
        if (parsed.success) { request.current = parsed.data; setUrl(parsed.data.url); setError("A previous save is unconfirmed. Retry it before saving another link."); }
      }
    } catch { /* No recoverable save. */ }
  }, [storageKey, userId]);
  const save = async () => {
    if (!userId || running.current) return;
    if (!request.current) {
      const source = detectSource();
      const trimmed = url.trim();
      const normalized = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const parsed = createBookmarkSchema.safeParse({ operationId: crypto.randomUUID(), url: normalized, browser: source.browser, device: source.device, os: source.os, savedAt: new Date().toISOString() });
      if (!parsed.success) { setError("Enter a valid http or https link."); return; }
      request.current = parsed.data;
    }
    running.current = true; setBusy(true); setError(null);
    let revoked = false;
    const unsubscribe = onExplicitSignOut(userId, () => { revoked = true; });
    try {
      localStorage.setItem(storageKey, JSON.stringify({ accountId: userId, input: request.current }));
      const { bookmark } = await createBookmark(request.current, userId);
      if (!mounted.current || revoked || account.current !== userId) return;
      localStorage.removeItem(storageKey); request.current = null;
      onSaved(bookmark);
    } catch (err) {
      if (mounted.current && !revoked && account.current === userId) setError(`${(err as Error).message}. Retry checks the same save. You can also recover it from Save a link later.`);
    } finally { unsubscribe(); running.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="[&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:right-1 [&>[data-slot=dialog-close]]:top-1 [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:place-items-center sm:max-w-md"><DialogHeader><DialogTitle>Save a link</DialogTitle><DialogDescription className="[overflow-wrap:anywhere]">Save your link, then confirm moving it to <strong className="font-medium text-foreground">{folder.path}</strong>. An already saved link keeps its labels.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}><Input autoFocus className="h-11" aria-label="Link to save" placeholder="https://example.com/article" value={url} disabled={busy || !!request.current} onChange={event => setUrl(event.target.value)} />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" className="min-h-11" disabled={busy || !url.trim()}>{busy ? "Saving…" : request.current ? "Retry save" : "Save and continue"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
