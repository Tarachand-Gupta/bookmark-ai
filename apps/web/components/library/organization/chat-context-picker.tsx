"use client";
import { OrganizationPicker } from "./picker";
import { useEffect, useState } from "react";
import type { Bookmark, ChatContext, LiveDevice, OrganizationResponse, Session } from "@bookmark-ai/types";
import { getLive, getOrganization, getSessions, listBookmarks, searchBookmarks } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./fields";
export function ChatContextPicker({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (context: ChatContext) => void }) {
  const [mode, setMode] = useState<"bookmarks" | "folder" | "session" | "live_window">("bookmarks");
  const [query, setQuery] = useState(""); const [rows, setRows] = useState<Bookmark[]>([]); const [ids, setIds] = useState<string[]>([]); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const [organization, setOrganization] = useState<OrganizationResponse | null>(null); const [sessions, setSessions] = useState<Session[]>([]); const [devices, setDevices] = useState<LiveDevice[]>([]); const [includeSubfolders, setIncludeSubfolders] = useState(true);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError(null);
    const timer = setTimeout(() => {
      const request = mode === "bookmarks" ? (query.trim() ? searchBookmarks(query, "text", controller.signal).then(r => r.results.map(r => r.bookmark)) : listBookmarks({}, { limit: 100, offset: 0 }, controller.signal).then(r => r.bookmarks)).then(value => { if (!controller.signal.aborted) setRows(value); })
        : mode === "folder" ? getOrganization(controller.signal).then(value => { if (!controller.signal.aborted) setOrganization(value); })
        : mode === "session" ? getSessions(controller.signal).then(value => { if (!controller.signal.aborted) setSessions(value.sessions); })
        : getLive(controller.signal).then(value => { if (!controller.signal.aborted) { setDevices(value.devices); if (!value.enabled) setError("Live sessions are off. Enable sharing in Settings, or choose saved bookmarks instead."); } });
      void request.catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, mode === "bookmarks" ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, mode]);
  const pick = (context: ChatContext) => { onSelect(context); setIds([]); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Choose context</DialogTitle><DialogDescription>Choose what this conversation can use. Membership is checked again when you send.</DialogDescription></DialogHeader>
    <label className="text-sm">Context source<OrganizationPicker className={fieldClass} value={mode} onValueChange={value => { setMode(value as typeof mode); setQuery(""); }}><option value="bookmarks">Saved bookmarks</option><option value="folder">A folder</option><option value="session">A saved session</option><option value="live_window">A shared live window</option></OrganizationPicker></label>
    {mode === "bookmarks" && <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search saved bookmarks" aria-label="Search saved bookmarks" />}
    {mode === "folder" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSubfolders} onChange={e => setIncludeSubfolders(e.target.checked)} />Include subfolders</label>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="max-h-80 overflow-auto space-y-1">{loading && <p role="status">Loading…</p>}
      {mode === "bookmarks" && <>{!loading && !rows.length && <p className="py-8 text-sm text-muted-foreground">No saved bookmarks match. Try a different search or save a link first.</p>}{rows.map(row => <label key={row.id} className="flex items-start gap-3 rounded-md p-2 hover:bg-muted"><input type="checkbox" checked={ids.includes(row.id)} disabled={!ids.includes(row.id) && ids.length >= 1000} onChange={() => setIds(prev => prev.includes(row.id) ? prev.filter(id => id !== row.id) : [...prev, row.id])} className="mt-1" /><span className="min-w-0"><span className="block text-sm font-medium">{row.title}</span><span className="block truncate text-xs text-muted-foreground">{row.url}</span></span></label>)}</>}
      {mode === "folder" && <>{organization?.folders.map(folder => <Button key={folder.id} variant="ghost" className="h-auto w-full justify-between whitespace-normal text-left" onClick={() => pick({ type: "folder", folderId: folder.id, includeSubfolders })}><span>{folder.path}</span><span>{includeSubfolders ? folder.count : folder.directCount}</span></Button>)}{!loading && !organization?.folders.length && <p className="p-4 text-sm text-muted-foreground">Create a folder in Manage organization, or choose saved bookmarks.</p>}</>}
      {mode === "session" && <>{sessions.map(session => <Button key={session.id} variant="ghost" className="h-auto w-full justify-between whitespace-normal text-left" onClick={() => pick({ type: "session", sessionId: session.id })}><span>{session.name}</span><span>{session.tabs.length} tabs</span></Button>)}{!loading && !sessions.length && <p className="p-4 text-sm text-muted-foreground">No saved sessions yet. Save a browser session from the extension, or choose saved bookmarks.</p>}</>}
      {mode === "live_window" && <>{devices.flatMap(device => device.windows.map(window => <Button key={`${device.deviceId}:${window.windowId}`} variant="ghost" className="h-auto w-full justify-between whitespace-normal text-left" onClick={() => pick({ type: "live_window", deviceId: device.deviceId, windowId: window.windowId })}><span>{device.label} · {window.name || `Window ${window.windowId}`}</span><span>{window.tabs.length} tabs</span></Button>))}{!loading && !devices.some(device => device.windows.length) && !error && <p className="p-4 text-sm text-muted-foreground">No windows are currently shared. Open the extension and share a window, or choose a saved session.</p>}</>}
    </div>
    {mode === "bookmarks" && <DialogFooter><span className="mr-auto text-sm">{ids.length} selected · up to 1,000</span><Button disabled={!ids.length} onClick={() => pick({ type: "bookmarks", bookmarkIds: ids })}>Add context</Button></DialogFooter>}
  </DialogContent></Dialog>;
}
