import {useState} from 'react';
import {Alert,View} from 'react-native';
import {operationRequest,useOrganization} from '../../context/OrganizationContext';
import {Action,Choice,Copy,Field,Sheet,styles} from './OrganizationSheet';
type Kind='category'|'tag';
export function ManageOrganization({onClose}:{onClose:()=>void}){
 const org=useOrganization();const [kind,setKind]=useState<Kind>('category'),[query,setQuery]=useState(''),[selected,setSelected]=useState<string|null>(null),[mode,setMode]=useState<'browse'|'new'|'rename'|'remove'|'merge'>('browse'),[name,setName]=useState(''),[destination,setDestination]=useState<string|null>(null),[destinationConfirmed,setDestinationConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const list=kind==='category'?org.data?.categories:org.data?.tags;
 const entity=list?.find(item=>item.id===selected);
 const reset=()=>{setMode('browse');setSelected(null);setName('');setDestination(null);setDestinationConfirmed(false);setError(null)};
 const execute=async(body:Record<string,unknown>)=>{setBusy(true);setError(null);try{const job=await org.execute(`${mode==='new'?'Create':mode==='remove'?'Remove':mode==='merge'?'Merge':'Rename'} ${kind}`,[operationRequest(body)]);const receipt=job.receipts[0];if(!receipt||receipt.failedCount)throw new Error(job.error??receipt?.results.find(r=>r.error)?.error?.message??'The result could not be confirmed. Open Recent changes.');reset();}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const submit=()=>{let body:Record<string,unknown>;
 if(mode==='new')body={action:`${kind}.create`,name:name.trim()};
 else if(mode==='rename')body={action:`${kind}.rename`,id:selected,name:name.trim()};
 else if(mode==='merge')body={action:'tag.merge',sourceId:selected,targetId:destination};
 else body={action:`${kind}.remove`,id:selected,...(kind==='category'?{replacementId:destination}:{})};
 const impact=mode==='remove'||mode==='merge';if(impact)Alert.alert(`${mode==='merge'?'Merge':'Remove'} ${entity?.name}?`,`${entity?.count??0} bookmarks across the library are affected. Bookmarks are kept. This change can be undone for seven days when no newer edit conflicts.`,[{text:'Cancel',style:'cancel'},{text:mode==='merge'?'Merge':'Remove',onPress:()=>void execute(body)}]);else void execute(body);
 };
 return <Sheet visible title="Categories & tags" onClose={()=>{if(!busy)onClose()}}>
 <View style={styles.row}>{(['category','tag'] as const).map(k=><Action key={k} label={k==='category'?'Categories':'Tags'} primary={kind===k} onPress={()=>{setKind(k);reset()}}/>)}</View>
 {mode==='browse'?<><Field label={`Search ${kind==='category'?'categories':'tags'}`} value={query} onChange={setQuery}/><Action primary label={`New ${kind}`} onPress={()=>setMode('new')}/>{list?.filter(item=>item.name.toLowerCase().includes(query.toLowerCase())).map(item=><View key={item.id} style={{gap:7}}><Choice label={item.name} detail={`${item.count} bookmarks across the library`} selected={selected===item.id} onPress={()=>setSelected(item.id)}/>{selected===item.id&&<View style={styles.row}><Action label="Rename" onPress={()=>{setName(item.name);setMode('rename')}}/>{kind==='tag'&&<Action label="Merge into…" onPress={()=>setMode('merge')}/>}<Action label="Remove" danger onPress={()=>{setMode('remove');setDestinationConfirmed(false)}}/></View>}</View>)}</>:<>
 <Copy>{entity?.name??`New ${kind}`}</Copy>{(mode==='new'||mode==='rename')&&<Field label="Name" value={name} onChange={setName} maxLength={kind==='tag'?40:80}/>}
 {mode==='remove'&&kind==='category'&&<><Copy>Choose a replacement for {entity?.count??0} bookmarks.</Copy><Choice label="Uncategorized" selected={destination===null} onPress={()=>{setDestination(null);setDestinationConfirmed(true)}}/>{org.data?.categories.filter(c=>c.id!==selected).map(c=><Choice key={c.id} label={c.name} selected={destination===c.id} onPress={()=>{setDestination(c.id);setDestinationConfirmed(true)}}/>)}</>}
 {mode==='merge'&&<><Copy>Merge {entity?.count??0} bookmark references into the chosen tag. Repeated tags collapse into one.</Copy>{org.data?.tags.filter(t=>t.id!==selected).map(t=><Choice key={t.id} label={t.name} detail={`${t.count} existing bookmark references`} selected={destination===t.id} onPress={()=>setDestination(t.id)}/>)}</>}
 {mode==='remove'&&kind==='tag'&&<Copy>This removes the tag from {entity?.count??0} bookmarks across the library. Every bookmark is kept.</Copy>}
 {<View style={styles.row}><Action label="Cancel" disabled={busy} onPress={reset}/><Action primary label={busy?'Applying…':mode==='new'?'Create':mode==='rename'?'Save name':mode==='merge'?'Merge tags':'Remove organization'} disabled={busy||((mode==='new'||mode==='rename')&&!name.trim())||(mode==='merge'&&!destination)||(mode==='remove'&&kind!=='tag'&&!destinationConfirmed)} onPress={submit}/></View>}
 </>}{error&&<Copy error>{error}</Copy>}
 </Sheet>;
}
