"use client";
import { useEffect, useRef, useState } from "react";
import { getOrganization, getOrganizationOperation, listOrganizationOperations, retryOrganizationOperation, undoOrganizationOperation, type OrganizationOperation, type OrganizationResponse } from "@/lib/api";
import { itemResultSummary, operationSummary, operationActionLabel, readableCurrentValues } from "@/lib/organization-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { readOrganizationRequests, runOrganizationRequest, type OrganizationRequest } from "@/lib/organization-requests";
import { Button } from "@/components/ui/button";
export function RecentChanges({ open, onClose, onResult, latest }: { open: boolean; onClose: () => void; onResult: (operation: OrganizationOperation) => void; latest?: OrganizationOperation | null }) {
  const { userId } = useAuth();
  const [organization, setOrganization] = useState<OrganizationResponse | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<OrganizationRequest[]>([]);
  const running = useRef(false);
  const [rows, setRows] = useState<OrganizationOperation[]>([]); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const pending = useRef<{ id: string; kind: "undo" | "retry"; operationId: string } | null>(null);
  const refresh = () => { try { setUnconfirmed(userId ? readOrganizationRequests(localStorage, userId) : []); } catch { /* Storage unavailable. */ } setLoading(true); void listOrganizationOperations().then(result => setRows(result.operations)).catch(err => setError(err.message)).finally(() => setLoading(false)); };
  useEffect(() => { if (open) { refresh(); void getOrganization().then(setOrganization).catch(() => undefined); } }, [open, latest?.id]);
  const replay = async (request: OrganizationRequest) => {
    if (running.current || !userId) return; running.current = true; setBusy(request.input.operationId); setError(null);
    try { const operation = await runOrganizationRequest(userId, request); pending.current = null; onResult(operation); }
    catch (err) { setError((err as Error).message); }
    finally { running.current = false; setBusy(null); refresh(); }
  };
  const run = async (id: string, kind: "undo" | "retry") => {
    const request = pending.current ?? { id, kind, operationId: crypto.randomUUID() }; pending.current = request;
    await replay({ kind: request.kind, targetId: request.id, input: { operationId: request.operationId } });
  };
  return <Dialog open={open} onOpenChange={visible => { if (!visible && !busy) onClose(); }}><DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-auto"><DialogHeader><DialogTitle>Recent changes</DialogTitle><DialogDescription>Undo is available for seven days. Later edits are protected; conflicts are shown individually.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{pending.current && !busy && <Button onClick={() => void run(pending.current!.id, pending.current!.kind)}>Retry same request</Button>}
    {unconfirmed.length > 0 && <section className="rounded border p-3 space-y-2"><h3 className="font-medium">Unconfirmed requests</h3><p className="text-sm text-muted-foreground">These requests keep their original IDs and values. Confirm them before starting an equivalent edit.</p>{unconfirmed.map(request => <div key={request.input.operationId} className="flex items-center gap-3 text-sm"><span className="flex-1">{request.kind === "organization" ? operationActionLabel(request.input.action) : request.kind === "bookmark" ? "Edit bookmark" : operationActionLabel(request.kind)}</span><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void replay(request)}>Confirm same request</Button></div>)}</section>}
    {loading && <p role="status" className="text-sm">Refreshing…</p>}{!loading && !rows.length && <p className="py-8 text-center text-sm text-muted-foreground">No organization changes yet. Moves, label edits and reading changes will appear here.</p>}
    <div className="space-y-3">{rows.map(operation => <section key={operation.id} className="rounded-lg border p-4 space-y-2"><h3 className="font-medium text-sm">{operationSummary(operation)}</h3><p className="text-xs text-muted-foreground">{new Date(operation.createdAt).toLocaleString()} · {operation.undoStatus === "expired" ? "Undo expired" : operation.undoStatus === "undone" ? "Undone" : operation.undoStatus === "unavailable" ? "Undo unavailable" : "Undo available until " + new Date(operation.undoExpiresAt).toLocaleDateString()}</p>
      <div className="flex gap-2">{["available", "partial"].includes(operation.undoStatus) && <Button variant="outline" size="sm" disabled={!!busy || !!pending.current} onClick={() => void run(operation.id, "undo")}>{busy === operation.id ? "Checking result…" : "Undo safe changes"}</Button>}{operation.failedCount > 0 && <Button variant="outline" size="sm" disabled={!!busy || !!pending.current} onClick={() => void run(operation.id, "retry")}>Retry {operation.failedCount} items</Button>}</div>
      <OperationResults operation={operation} organization={organization} />
    </section>)}</div>
  </DialogContent></Dialog>;
}

function OperationResults({ operation, organization }: { operation: OrganizationOperation; organization: OrganizationResponse | null }) {
  const [expanded, setExpanded] = useState(false); const [visible, setVisible] = useState(50);
  return <details className="text-sm" onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer">View {operation.results.length} item results</summary>{expanded && <><ul className="mt-2 space-y-2">{operation.results.slice(0, visible).map((result, index) => <li key={result.id + ":" + index} className="rounded bg-muted/50 p-2">{result.entityType === "bookmark" ? <a href={"/app/library?bookmark=" + encodeURIComponent(result.id)} className="underline">{result.label || "Bookmark " + (index + 1)}</a> : <span>{result.label || "Affected item " + (index + 1)}</span>} · {itemResultSummary(result, !!operation.undoOf)}{result.error && <p className="mt-1 text-destructive">{result.error.message}</p>}{result.error?.current && <dl className="break-words text-xs text-muted-foreground">{readableCurrentValues(result.error.current, organization).map(field => <div key={field.label}><dt className="inline font-medium">{field.label}: </dt><dd className="inline">{field.value}</dd></div>)}</dl>}</li>)}</ul>{operation.results.length > visible && <Button variant="ghost" size="sm" onClick={() => setVisible(n => n + 50)}>Show next {Math.min(50, operation.results.length - visible)} results</Button>}</>}</details>;
}
