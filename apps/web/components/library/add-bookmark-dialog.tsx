"use client";

import { useEffect, useRef, useState } from "react";
import type { Bookmark, CreateBookmarkInput } from "@bookmark-ai/types";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createBookmark } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { onExplicitSignOut } from "@/lib/account-private-state";
import { detectSource } from "@/lib/detect";

export interface AddBookmarkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onEdit?: (bookmark: Bookmark) => void;
  folderNames?: Record<string, string>;
}

/** Paste-a-URL save flow for the web app (extension covers in-browser saves). */
export function AddBookmarkDialog({ open, onOpenChange, onSaved, onEdit, folderNames }: AddBookmarkDialogProps) {
  const { userId } = useAuth();
  const running = useRef(false);
  const storageKey = `bmai:save-request:v1:${userId}`;
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Bookmark | null>(null);
  const [existing, setExisting] = useState(false);
  const request = useRef<CreateBookmarkInput | null>(null);
  useEffect(() => {
    if (!open || !userId) return;
    try { const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null"); if (stored?.accountId === userId && stored.input?.operationId && stored.input?.url) { request.current = stored.input; setUrl(stored.input.url); setError("A previous save has an unconfirmed result. Retry the same request to check it."); } } catch { /* Empty or restricted storage. */ }
  }, [open, userId, storageKey]);
  const close = (value: boolean) => { if (saving) return; onOpenChange(value); if (!value) { setSaved(null); setUrl(""); request.current = null; setError(null); } };

  const save = async () => {
    const trimmed = url.trim();
    if (!trimmed || running.current || !userId) return;
    running.current = true;
    let revoked = false; const unsubscribe = onExplicitSignOut(userId, () => { revoked = true; });
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setSaving(true);
    setError(null);
    try {
      const source = detectSource();
      request.current ??= {
        operationId: crypto.randomUUID(),
        url: normalized,
        browser: source.browser,
        device: source.device,
        os: source.os,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(storageKey, JSON.stringify({ accountId: userId, input: request.current }));
      const { bookmark, existing } = await createBookmark(request.current, userId);
      if (revoked) return;
      localStorage.removeItem(storageKey);
      setSaved(bookmark);
      setExisting(!!existing);
      request.current = null;
      onSaved();
    } catch (err) {
      if (!revoked) setError(`${(err as Error).message}. Retry uses the same save request, so it cannot create another copy. Closing keeps this request for your next visit.`);
    } finally {
      unsubscribe(); running.current = false; setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{saved ? existing ? "Already saved" : "Bookmark saved" : "Add a bookmark"}</DialogTitle>
          <DialogDescription>
            {saved ? "Your link is saved. Organizing it is optional." : "Save a URL now. Choose a folder, labels or reading state afterward."}
          </DialogDescription>
        </DialogHeader>
        {saved ? <div className="space-y-4"><div><p className="font-medium break-words">{saved.title}</p><p className="text-sm text-muted-foreground break-all">{saved.domain}</p></div><p className="text-sm">Saved to {saved.folderId ? folderNames?.[saved.folderId] ?? "your assigned folder" : "Unsorted"}</p><div className="flex flex-wrap gap-2">{onEdit && <Button onClick={() => { const bookmark = saved; close(false); onEdit(bookmark); }}>Edit details / Change folder</Button>}<Button variant="outline" asChild><a href={saved.url} target="_blank" rel="noopener noreferrer">Open</a></Button><Button variant="ghost" onClick={() => close(false)}>Done</Button></div></div> : <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            aria-label="Bookmark URL"
            disabled={saving || !!request.current}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={saving || !url.trim()}>
              {saving ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                request.current ? "Retry save" : "Save bookmark"
              )}
            </Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
