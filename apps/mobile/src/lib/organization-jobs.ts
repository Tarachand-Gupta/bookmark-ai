import type { BulkBookmarkChanges, OrganizationOperation, OrganizationSelection } from '@bookmark-ai/types';

export interface OrganizationRequest { path: string; method: 'POST'|'PATCH'; body: Record<string, unknown> & {operationId: string}; }
export interface OrganizationJob { id: string; label: string; requests: OrganizationRequest[]; next: number; receipts: OrganizationOperation[]; status: 'paused'|'running'|'uncertain'|'completed'|'failed'; error?: string; createdAt: string; }
export interface JobAdapter { save(job: OrganizationJob): Promise<void>; send(request: OrganizationRequest): Promise<OrganizationOperation>; reconcile(id: string): Promise<OrganizationOperation|null>; }

/** Immutable batches, including the original field versions for unloaded rows. */
export function bulkRequests(selection: OrganizationSelection, changes: BulkBookmarkChanges, uuid: () => string, max=500): OrganizationRequest[] {
  if (!selection.count || selection.count !== selection.bookmarkIds.length) throw new Error('Select bookmarks first.');
  const size = Math.min(500, Math.max(1,max));
  const ids = [...new Set(selection.bookmarkIds)];
  return Array.from({length:Math.ceil(ids.length/size)},(_,index)=>{
    const bookmarkIds=ids.slice(index*size,(index+1)*size);
    return {path:'/api/organization/operations',method:'POST' as const,body:{operationId:uuid(),action:'bookmarks.update',bookmarkIds,changes:structuredClone(changes),expected:Object.fromEntries(bookmarkIds.map(id=>[id,{...(selection.fieldVersions[id]??{})}]))}};
  });
}
export function newOrganizationJob(label:string, requests:OrganizationRequest[], id:string):OrganizationJob {
  return {id,label,requests:structuredClone(requests),next:0,receipts:[],status:'paused',createdAt:new Date().toISOString()};
}
/** Persist BEFORE dispatch and AFTER receipt. A lost response retains the same identity.
 * A process crash between receipt and save replays server idempotency, never a new mutation. */
export async function runOrganizationJob(initial:OrganizationJob, adapter:JobAdapter, pause:()=>boolean=()=>false):Promise<OrganizationJob> {
  let job=structuredClone(initial);
  if(job.status==='completed') return job;
  const uncertain=job.status==='uncertain'||job.status==='running';
  job={...job,status:'running',error:undefined};
  await adapter.save(job);
  for(;job.next<job.requests.length;) {
    const request=job.requests[job.next];
    try {
      const receipt=(uncertain && job.next===initial.next ? await adapter.reconcile(request.body.operationId):null) ?? await adapter.send(request);
      job={...job,next:job.next+1,receipts:[...job.receipts,receipt]};
      job.status=job.next===job.requests.length?'completed':pause()?'paused':'running';
      await adapter.save(job);
      if(job.status==='paused') return job;
    }catch(error) {
      // Even a proxy failure may follow a committed transaction. Keep the exact
      // request until a receipt or a same-ID retry makes the outcome definite.
      const status=(error as {status?:number})?.status;
      const definitive=status!==undefined&&[400,401,403,404,409,422].includes(status);
      job={...job,status:definitive?'failed':'uncertain',error:error instanceof Error?error.message:'The result could not be confirmed.'};
      await adapter.save(job);
      return job;
    }
  }
  return job;
}
export function jobProgress(job:OrganizationJob):{accepted:number;total:number;succeeded:number;failed:number} {
  return {accepted:job.next,total:job.requests.length,succeeded:job.receipts.reduce((n,r)=>n+r.succeededCount,0),failed:job.receipts.reduce((n,r)=>n+r.failedCount,0)};
}
export function fieldLabel(field:string):string { return ({folderId:'Folder',categoryId:'Category',tags:'Tags',title:'Title',readingState:'Reading list',parentId:'Parent folder',name:'Name'} as Record<string,string>)[field]??'Details'; }
export function selectionContext(ids:string[]):{type:'bookmarks';bookmarkIds:string[]} {
  if(ids.length>1000) throw new Error('Ask AI can use up to 1,000 selected bookmarks. Narrow the selection, choose a folder, or start a whole-library chat.');
  return {type:'bookmarks',bookmarkIds:[...ids]};
}
