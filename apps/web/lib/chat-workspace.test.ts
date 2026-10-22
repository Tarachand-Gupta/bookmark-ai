import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspace, restoreDrafts, serializeDrafts, workspaceStorageKey } from "./chat-workspace";
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
function response(body = "Hello") { return new Response([ {type:"start",messageId:"reply"}, {type:"text-start",id:"part"}, {type:"text-delta",id:"part",delta:body}, {type:"text-end",id:"part"}, {type:"finish",finishReason:"stop"} ].map(p => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type":"text/event-stream", "x-vercel-ai-ui-message-stream":"v1", "X-Conversation-Id":"conversation-a" } }); }
afterEach(() => vi.unstubAllGlobals());
describe("account-owned chat workspace", () => {
  it("keeps drafts across conversation switches and refuses another account's storage", () => {
    const storage = memory(); const workspace = new ChatWorkspace("one", async () => ({})); workspace.hydrate(storage);
    const first = workspace.activeKey; workspace.patch({text:"first draft"}); workspace.create(); workspace.patch({text:"second draft"}); workspace.select(first);
    expect(workspace.active.text).toBe("first draft");
    const reloaded = new ChatWorkspace("one", async () => ({})); reloaded.hydrate(storage); expect(reloaded.active.text).toBe("first draft");
    expect(restoreDrafts(storage.getItem(workspaceStorageKey("one")), "two")).toBeNull();
  });
  it("persists file descriptors without attachment bytes and permits session drafts in restricted storage", () => {
    const workspace = new ChatWorkspace("one", async () => ({})); workspace.hydrate({getItem(){throw Error("denied");},setItem(){throw Error("denied");},removeItem(){}}); workspace.patch({text:"retained in memory"});
    expect(workspace.active.text).toBe("retained in memory");
    const raw = serializeDrafts("one", workspace.activeKey, [{key:workspace.activeKey,conversationId:null,title:"Draft",text:"Text",context:{type:"library"},updatedAt:"2026-10-16",interrupted:false,missingFiles:[], files:[{id:"file",type:"file",mediaType:"text/plain",filename:"notes.txt",url:"data:text/plain;base64,PRIVATE"}]}]);
    expect(raw).not.toContain("PRIVATE"); expect(restoreDrafts(raw,"one")?.drafts[0]?.missingFiles[0]?.filename).toBe("notes.txt");
  });
  it("freezes context at submit and completes the original thread while another draft is visible", async () => {
    let resolve!: (r: Response) => void; const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal("fetch", fetch);
    const workspace = new ChatWorkspace("one", async () => ({})); workspace.patch({text:"summarize",context:{type:"bookmarks",bookmarkIds:["a"]}}); const original = workspace.active;
    workspace.send(); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); workspace.patch({context:{type:"bookmarks",bookmarkIds:["b"]}}); workspace.create(); workspace.patch({text:"unrelated next draft"});
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).context).toEqual({ type: "bookmarks", bookmarkIds: ["a"] });
    resolve(response()); await vi.waitFor(() => expect(original.chat.status).toBe("ready"));
    expect(original.chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({type:"text",text:"Hello"})); expect(workspace.active.text).toBe("unrelated next draft");
  });
  it("does not send after account disposal while credentials are pending", async () => {
    let release!: (headers: Record<string,string>) => void; const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    const workspace = new ChatWorkspace("one", () => new Promise(r => {release=r;})); workspace.patch({text:"private"}); workspace.send(); await vi.waitFor(() => expect(release).toBeDefined()); workspace.dispose(); release({authorization:"test"});
    await vi.waitFor(() => expect(workspace.active.chat.status).not.toBe("submitted")); expect(fetch).not.toHaveBeenCalled();
  });
  it("recovers a failed turn separately when newer draft text already exists and does not gate the next send", async () => {
    let reject!: (reason: Error) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((_, r) => {reject=r;})));
    const workspace = new ChatWorkspace("one", async () => ({})); workspace.patch({text:"failed message"}); workspace.send(); await vi.waitFor(() => expect(reject).toBeDefined()); workspace.patch({text:"newer draft"}); reject(Error("offline"));
    await vi.waitFor(() => expect(workspace.active.recoverable?.text).toBe("failed message")); expect(workspace.active.pending).toBeNull(); expect(workspace.active.text).toBe("newer draft");
    const previous = workspace.activeKey; workspace.recoverFailedTurn(); expect(workspace.active.text).toBe("failed message"); workspace.select(previous); expect(workspace.active.text).toBe("newer draft");
  });
  it("explicit logout erases storage and late patches or disposal cannot resurrect it", () => {
    const storage = memory(); const workspace = new ChatWorkspace("one", async () => ({})); workspace.hydrate(storage); workspace.patch({text:"private"}); workspace.clearPrivateData(); workspace.patch({text:"late"}); workspace.dispose();
    expect(storage.getItem(workspaceStorageKey("one"))).toBeNull();
  });
  it("preserves an old scoped draft through reloads and blocks sending until context is explicitly chosen", async () => {
    const storage = memory();
    storage.setItem(workspaceStorageKey("one"), JSON.stringify({version:1,accountId:"one",activeKey:"old",drafts:[{key:"old",conversationId:null,title:"Old draft",text:"Keep my research",context:{type:"folder",folderId:"old-folder"},files:[],missingFiles:[],updatedAt:"2026-10-16",interrupted:false}]}));
    const fetch = vi.fn(() => Promise.resolve(response())); vi.stubGlobal("fetch", fetch);
    const first = new ChatWorkspace("one", async () => ({})); first.hydrate(storage);
    expect(first.active.text).toBe("Keep my research"); expect(first.active.contextNeedsReview).toBe(true);
    first.patch({text:"Keep my edited research"}); first.dispose();
    const reloaded = new ChatWorkspace("one", async () => ({})); reloaded.hydrate(storage);
    expect(reloaded.active.text).toBe("Keep my edited research"); expect(reloaded.active.contextNeedsReview).toBe(true);
    reloaded.send(); await Promise.resolve(); expect(fetch).not.toHaveBeenCalled();
    reloaded.patch({context:{type:"bookmarks",bookmarkIds:["selected"]}}); reloaded.send();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [unknown, RequestInit])[1].body as string).context).toEqual({type:"bookmarks",bookmarkIds:["selected"]});
  });
  it("retains an old failed message separately and requires context review when recovered", () => {
    const storage = memory();
    storage.setItem(workspaceStorageKey("one"), JSON.stringify({version:1,accountId:"one",activeKey:"old",drafts:[{key:"old",conversationId:null,title:"Draft",text:"Newer text",context:{type:"library"},files:[],missingFiles:[],updatedAt:"2026-10-16",interrupted:false,recoverable:{text:"Failed scoped turn",context:{type:"folder",folderId:"old-folder"},missingFiles:[]}}]}));
    const workspace = new ChatWorkspace("one", async () => ({})); workspace.hydrate(storage);
    expect(workspace.active.text).toBe("Newer text"); workspace.recoverFailedTurn();
    expect(workspace.active.text).toBe("Failed scoped turn"); expect(workspace.active.contextNeedsReview).toBe(true);
    const reloaded = new ChatWorkspace("one", async () => ({})); reloaded.hydrate(storage);
    expect(reloaded.active.contextNeedsReview).toBe(true); reloaded.patch({context:{type:"library"}});
    expect(reloaded.active.contextNeedsReview).toBe(false); reloaded.select("old"); expect(reloaded.active.text).toBe("Newer text");
  });
});
