import { describe, expect, it, vi } from "vitest";
import type { OrganizationOperation } from "@bookmark-ai/types";
import { createBatchJob, runBatchJob, readBatchJob, writeBatchJob } from "./organization-batches";
const receipt = (id: string): OrganizationOperation => ({id,action:"bookmarks.update",description:"Set category",createdAt:"2026-10-16",undoExpiresAt:"2026-10-23",status:"completed",requestedCount:1,succeededCount:1,failedCount:0,results:[],undoStatus:"available"});
describe("durable bulk coordinator", () => {
  it("freezes 1001 items into 500/500/1 with immutable field versions before any request", async () => {
    const ids = Array.from({length:1001}, (_,i) => `id-${i}`); const expected = {"id-0":{categoryId:"v1"}};
    const job = createBatchJob("account",ids,{categoryId:"category"},500,expected); ids.pop(); expected["id-0"].categoryId="changed";
    expect(job.batches.map(b=>b.bookmarkIds.length)).toEqual([500,500,1]); const saved: string[]=[];
    const apply = vi.fn(async input => { expect(saved.length).toBeGreaterThan(0); expect(input.expected?.["id-0"]?.categoryId).not.toBe("changed"); return {operation:receipt(input.operationId)}; });
    await runBatchJob(job,{apply,reconcile:vi.fn(),save:value=>saved.push(JSON.stringify(value)),shouldPause:()=>false,onReceipt:vi.fn()});
    expect(apply).toHaveBeenCalledTimes(3); expect(job.state).toBe("complete"); expect(new Set(job.batches.map(b=>b.operationId)).size).toBe(3);
  });
  it("reconciles an accepted response lost in transit without replaying it", async () => {
    const job=createBatchJob("account",["a"],{addTags:["review"]}); const reconcile=vi.fn(async id=>({operation:receipt(id)}));
    await runBatchJob(job,{apply:vi.fn(async()=>{throw Error("network lost");}),reconcile,save:vi.fn(),shouldPause:()=>false,onReceipt:vi.fn()});
    expect(reconcile).toHaveBeenCalledWith(job.batches[0].operationId); expect(job.state).toBe("complete");
  });
  it("pauses after the accepted batch and resumes remaining IDs without replaying success", async () => {
    const job=createBatchJob("account",["a","b","c"],{categoryId:null},1); let pause=false; const apply=vi.fn(async input=>{pause=true;return {operation:receipt(input.operationId)};});
    const dependencies={apply,reconcile:vi.fn(),save:vi.fn(),shouldPause:()=>pause,onReceipt:vi.fn()}; await runBatchJob(job,dependencies); expect(job.state).toBe("paused"); expect(apply).toHaveBeenCalledTimes(1);
    await runBatchJob(job,{...dependencies,shouldPause:()=>false}); expect(apply).toHaveBeenCalledTimes(3); expect(job.state).toBe("complete");
  });
  it("unknown retries reuse the same identity and survive reload under the same account only", async () => {
    let raw=""; const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
    const job=createBatchJob("account",["a"],{categoryId:null}); const failed={apply:vi.fn(async()=>{throw Error("offline");}),reconcile:vi.fn(async()=>{throw Error("offline");}),save:(next:typeof job)=>writeBatchJob(storage,next),shouldPause:()=>false,onReceipt:vi.fn()};
    await runBatchJob(job,failed); expect(job.state).toBe("unknown"); expect(readBatchJob(storage,"other")).toBeNull(); const reloaded=readBatchJob(storage,"account")!;
    const apply=vi.fn(async input=>({operation:receipt(input.operationId)})); await runBatchJob(reloaded,{...failed,apply}); expect(apply.mock.calls[0][0].operationId).toBe(job.batches[0].operationId);
  });
  it("refuses to send when recovery storage cannot be written", async () => {
    const apply=vi.fn(); await expect(runBatchJob(createBatchJob("a",["b"],{categoryId:null}),{apply,reconcile:vi.fn(),save:()=>{throw Error("quota");},shouldPause:()=>false,onReceipt:vi.fn()})).rejects.toThrow("quota"); expect(apply).not.toHaveBeenCalled();
  });
});
