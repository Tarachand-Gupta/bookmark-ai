"use client";
import { useEffect, useRef, useState } from "react";
import { organizationOperationSchema, type OrganizationFolder, type OrganizationResponse, type OrganizationOperation } from "@bookmark-ai/types";
import { useAuth } from "@/lib/auth";
import { useOrganizationMutation } from "@/hooks/use-organization";
import { operationSummary } from "@/lib/organization-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderField, fieldClass } from "./fields";
import { OrganizationPicker } from "./picker";
import type { FolderAction } from "./folder-browser";

export function FolderActionDialog({ folder, action, data, onClose, onResult }: { folder: OrganizationFolder; action: FolderAction; data: OrganizationResponse; onClose: () => void; onResult: (result: OrganizationOperation) => void }) {
  const [name, setName] = useState(folder.name);
  const [destination, setDestination] = useState<string | null>(folder.parentId);
  const [children, setChildren] = useState<"parent" | "destination">("parent");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OrganizationOperation | null>(null);
  const { userId } = useAuth();
  const account = useRef(userId); account.current = userId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useOrganizationMutation(result => { if (!mounted.current || userId !== account.current) return; setReceipt(result); onResult(result); });
  const childCount = data.folders.filter(f => f.parentId === folder.id).length;
  const submit = () => {
    if (mutation.uncertain) { mutation.retry(); return; }
    const operationId = crypto.randomUUID();
    const input = action === "remove" ? { operationId, action: "folder.remove", id: folder.id, destinationId: destination, children } : { operationId, action: "folder.update", id: folder.id, expected: folder.fieldVersions, ...(action === "rename" ? { name: name.trim() } : { parentId: destination }) };
    const parsed = organizationOperationSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the selected values."); return; }
    setError(null); void mutation.run(parsed.data);
  };
  const label = action === "rename" ? "Rename folder" : action === "move" ? "Move folder" : "Remove folder";
  return <Dialog open onOpenChange={open => { if (!open && !mutation.busy) onClose(); }}><DialogContent className="[&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:right-1 [&>[data-slot=dialog-close]]:top-1 [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:place-items-center max-h-[90dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription className="[overflow-wrap:anywhere]">{folder.path}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit(); }}>
      {!receipt && <fieldset className="space-y-4" disabled={mutation.busy || !!mutation.uncertain}>
        {action === "rename" ? <label className="block text-sm font-medium">Folder name<Input autoFocus className="mt-2 h-11" value={name} onChange={event => setName(event.target.value)} /></label> : <FolderField data={data} movingId={folder.id} label={action === "move" ? "Parent folder" : "Move bookmarks to"} value={destination} onChange={setDestination} />}
        {action === "remove" && <><p className="text-sm text-muted-foreground">{folder.directCount} bookmark{folder.directCount === 1 ? "" : "s"} will move to {destination ? data.folders.find(f => f.id === destination)?.path : "Unsorted"}. Your saved links and labels are kept.</p>{childCount > 0 && <label className="block text-sm">{childCount} immediate subfolder{childCount === 1 ? "" : "s"}<OrganizationPicker aria-label="Place subfolders" className={fieldClass} value={children} onValueChange={value => setChildren(value as "parent" | "destination")}><option value="parent">Keep under the current parent</option><option value="destination">Move to the chosen destination</option></OrganizationPicker></label>}</>}
      </fieldset>}
      {receipt && <p role="status" className="text-sm">{operationSummary(receipt)}{receipt.failedCount ? " Review details in Recent changes." : ""}</p>}
      {(error || mutation.error) && <p role="alert" className="text-sm text-destructive">{error || mutation.error}</p>}
      {mutation.uncertain && <p className="text-sm text-muted-foreground">The result is unconfirmed. Retry checks this same change.</p>}
      <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={mutation.busy} onClick={onClose}>{receipt ? "Done" : "Cancel"}</Button>{!receipt && <Button type="submit" variant={action === "remove" ? "destructive" : "default"} className="min-h-11" disabled={mutation.busy || (action === "rename" && !name.trim())}>{mutation.busy ? "Saving…" : mutation.uncertain ? "Retry same change" : label}</Button>}</DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
