import type {ChatContext} from '@bookmark-ai/types';
export interface ComposerDraft { key:string; conversationId:string|null; title:string; text:string; context:ChatContext; attachmentCount:number; lostAttachments:boolean; interrupted:boolean; }
export function freshDraft(key:string,context:ChatContext={type:'library'}):ComposerDraft{return {key,conversationId:null,title:'New chat',text:'',context:structuredClone(context),attachmentCount:0,lostAttachments:false,interrupted:false};}
export function hasDraft(draft:ComposerDraft):boolean{return !!draft.text.trim()||draft.attachmentCount>0;}
export function contextLabel(context:ChatContext,folderName?:string):string{switch(context.type){case'library':return'Whole library';case'bookmarks':return`${context.bookmarkIds.length} selected bookmarks`;case'folder':return`Folder: ${folderName??'selected folder'}${context.includeSubfolders?' and subfolders':''}`;case'page':return context.title||'Current page';case'session':return'Saved session';case'live_window':return'Live browser window';}}
/** File bytes are intentionally session-only. Restored drafts explicitly request reattachment. */
export function recoverDrafts(raw:string):ComposerDraft[]{try{return(JSON.parse(raw) as ComposerDraft[]).filter(d=>typeof d.key==='string'&&typeof d.text==='string'&&d.context).map(d=>({...d,lostAttachments:d.lostAttachments||d.attachmentCount>0,attachmentCount:0}));}catch{return[];}}
export function serializeDrafts(drafts:ComposerDraft[]):string{return JSON.stringify(drafts.map(d=>({...d,text:d.text.slice(0,32000)})));}
