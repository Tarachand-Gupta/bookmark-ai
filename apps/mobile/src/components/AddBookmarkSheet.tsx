import {useEffect,useState} from 'react';
import {View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import type {Bookmark} from '@bookmark-ai/types';
import {createBookmark,detectSource,getBookmarkByUrl} from '../api';
import {useOrganization} from '../context/OrganizationContext';
import {normalizeUrl} from '../lib/share-intent';
import {openBookmark} from '../lib/bookmarkActions';
import {Action,Copy,Field,Sheet,styles} from './organization/OrganizationSheet';
import {BookmarkEditor} from './organization/BookmarkEditor';
import {RecentChanges} from './organization/RecentChanges';
export function AddBookmarkSheet({visible,onClose,onSaved,initialUrl=null}:{visible:boolean;onClose:()=>void;onSaved:()=>void;initialUrl?:string|null}){
 const org=useOrganization();const [url,setUrl]=useState(''),[title,setTitle]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState<Bookmark|null>(null),[existing,setExisting]=useState(false),[pendingId,setPendingId]=useState<string|null>(null),[editing,setEditing]=useState(false),[history,setHistory]=useState(false);
 useEffect(()=>{if(visible){setUrl(initialUrl??'');setTitle('');setError(null);setSaved(null);setPendingId(null);setSaving(false);setExisting(false);}},[visible,initialUrl]);
 const normalized=normalizeUrl(url),capable=!!org.data?.capabilities.organization;
 const finish=async()=>{const result=await getBookmarkByUrl(normalized!);if(!result.bookmarks[0])throw new Error('The save was accepted, but its details could not be loaded. View your Library or retry loading details.');setSaved(result.bookmarks[0]);setPendingId(null);void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);onSaved();org.changed();};
 const save=async()=>{if(!normalized||saving)return;setSaving(true);setError(null);try{
 if(pendingId){const recovered=await org.resume(pendingId);if(recovered?.status!=='completed'||!recovered.receipts.length||recovered.receipts.some(receipt=>receipt.failedCount>0))throw new Error(recovered?.error??'This save is still unconfirmed. Open Recent changes to reconcile it.');setExisting(recovered.receipts[0]?.existing??false);await finish();return;}
 const input={url:normalized,title:title.trim()||undefined,...detectSource()};
 if(capable){const job=await org.execute('Save bookmark',[{path:'/api/bookmarks',method:'POST',body:{...input,operationId:Crypto.randomUUID()}}]);if(job.status!=='completed'||job.receipts[0]?.failedCount){setPendingId(job.id);throw new Error(job.error??'The save could not be confirmed. Reconcile the same request or review Recent changes.');}setExisting(job.receipts[0]?.existing??false);await finish();}
 else{const result=await createBookmark(input);setSaved(result.bookmark);setExisting(result.existing??false);onSaved();}
 }catch(e){setError((e as Error).message)}finally{setSaving(false)}};
 return <Sheet visible={visible} title={saved?(existing?'Already saved':'Bookmark saved'):'Save a link'} onClose={()=>{if(!saving)onClose()}} footer={saved?<View style={styles.row}>{capable&&<Action primary label="Edit details" onPress={()=>setEditing(true)}/>}<Action label="View link" onPress={()=>openBookmark(saved)}/><Action label="Done" onPress={onClose}/></View>:<Action primary label={saving?'Saving…':pendingId?'Reconcile save':'Save link'} disabled={!normalized||saving||(!org.data&&!org.error)||!!(capable&&!org.accountId)} onPress={()=>void save()}/> }>
 {saved?<><Copy>{saved.title}</Copy><Copy>{saved.domain} · {org.data?.folders.find(f=>f.id===saved.folderId)?.path??'Unsorted'}</Copy><Copy>The link is saved. You can organize it now or return later.</Copy></>:<><Field label="Link" value={url} onChange={value=>{if(!pendingId&&!saving)setUrl(value)}} maxLength={8000}/><Action label="Paste link" disabled={!!pendingId||saving} onPress={()=>void Clipboard.getStringAsync().then(value=>setUrl(value.trim()))}/><Field label="Title (optional)" value={title} onChange={value=>{if(!pendingId&&!saving)setTitle(value)}} maxLength={2000}/><Copy>Save first, then optionally choose a folder, category, tags or reading status. Existing bookmarks are recognized.</Copy>{pendingId&&<><Action label="Recent changes" onPress={()=>setHistory(true)}/><Action label="Start another save" onPress={()=>{setPendingId(null);setUrl('');setTitle('');setError(null)}}/></>}</>}
 {error&&<Copy error>{error}</Copy>}{editing&&saved&&<BookmarkEditor bookmark={saved} onClose={()=>setEditing(false)} onSaved={()=>{void getBookmarkByUrl(saved.url).then(result=>{if(result.bookmarks[0])setSaved(result.bookmarks[0])});onSaved()}}/>} {history&&<RecentChanges onClose={()=>setHistory(false)}/>}
 </Sheet>;
}
