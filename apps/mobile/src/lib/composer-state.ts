import type {ChatContext} from '@bookmark-ai/types';
export interface ComposerDraft { key:string; conversationId:string|null; title:string; text:string; context:ChatContext; attachmentCount:number; lostAttachments:boolean; interrupted:boolean; contextUnavailable?:boolean; }
export function freshDraft(key:string,context:ChatContext={type:'library'}):ComposerDraft{return {key,conversationId:null,title:'New chat',text:'',context:structuredClone(context),attachmentCount:0,lostAttachments:false,interrupted:false};}
export function hasDraft(draft:ComposerDraft):boolean{return !!draft.text.trim()||draft.attachmentCount>0;}
export function contextLabel(context:ChatContext):string {
  switch(context.type) {
    case 'library': return 'Whole library';
    case 'bookmarks': return `${context.bookmarkIds.length} selected bookmarks`;
    default: return 'Selected bookmarks';
  }
}
/** File bytes are intentionally session-only. Restored drafts explicitly request reattachment. */
export function recoverDrafts(raw:string):ComposerDraft[] {
  try {
    return (JSON.parse(raw) as ComposerDraft[])
      .filter(d=>typeof d.key==='string'&&typeof d.text==='string'&&d.context)
      .map(d=>{
        const supported=['library','bookmarks','selection'].includes(d.context.type);
        return {...d,context:supported?d.context:{type:'library'},contextUnavailable:d.contextUnavailable||!supported,lostAttachments:d.lostAttachments||d.attachmentCount>0,attachmentCount:0};
      });
  } catch { return []; }
}
export function serializeDrafts(drafts:ComposerDraft[]):string{return JSON.stringify(drafts.map(d=>({...d,text:d.text.slice(0,32000)})));}
