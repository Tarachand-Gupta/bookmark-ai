import {useEffect,useState} from 'react';
import {Alert,View} from 'react-native';
import type {Bookmark,OrganizationSelection} from '@bookmark-ai/types';
import {freezeOrganizationSelection,type SelectionInput} from '../api';
import {useOrganization} from '../context/OrganizationContext';
import {useOrganizationUi} from '../context/OrganizationUiContext';
import {useComposer} from '../context/ComposerContext';
import {selectionContext} from '../lib/organization-jobs';
import {Action,Copy,styles} from '../components/organization/OrganizationSheet';
import {BulkEditor} from '../components/organization/BulkEditor';
export function useBookmarkSelection(key:string,active:boolean,all:SelectionInput){
 const org=useOrganization(),ui=useOrganizationUi(),composer=useComposer();const [selecting,setSelecting]=useState(false),[ids,setIds]=useState<string[]>([]),[snapshot,setSnapshot]=useState<OrganizationSelection|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const supported=!!org.data?.capabilities.organization&&!!org.accountId;
 useEffect(()=>{composer.block(`selection-${key}`,selecting&&active);return()=>composer.block(`selection-${key}`,false)},[selecting,active,key,composer.block]);
 const toggle=(bookmark:Bookmark)=>{if(!supported)return;setSelecting(true);setSnapshot(null);setIds(prev=>prev.includes(bookmark.id)?prev.filter(id=>id!==bookmark.id):[...prev,bookmark.id]);};
 const freeze=async(input:SelectionInput)=>{setBusy(true);setError(null);try{const {selection}=await freezeOrganizationSelection(input);setSnapshot(selection);setIds(selection.bookmarkIds);return selection;}catch(e){setError((e as Error).message);return null;}finally{setBusy(false)}};
 const organize=async()=>{const frozen=snapshot??await freeze({bookmarkIds:ids});if(frozen)setEditing(true)};
 const ask=async()=>{const frozen=snapshot??await freeze({bookmarkIds:ids});if(!frozen)return;try{composer.open(selectionContext(frozen.bookmarkIds))}catch(e){Alert.alert('Choose a smaller chat scope',(e as Error).message,[{text:'Keep selecting',style:'cancel'},{text:'Whole-library chat',onPress:()=>composer.open({type:'library'})}]);}};
 const done=()=>{setSelecting(false);setIds([]);setSnapshot(null);};
 const controls=supported&&<View style={{gap:8,paddingHorizontal:20,paddingVertical:8}}>{selecting?<><Copy>{ids.length} selected{snapshot?' · frozen snapshot':''}</Copy><View style={styles.row}><Action label="Done" onPress={done}/><Action label={'search'in all&&all.search.mode!=='keyword'?'Select top ranked results (up to 200)':'Select all matching'} disabled={busy||org.offline} onPress={()=>void freeze(all)}/><Action label="Organize" disabled={busy||org.offline||!ids.length} onPress={()=>void organize()}/><Action label="Ask AI" disabled={busy||org.offline||!ids.length} onPress={()=>void ask()}/><Action label="Recent changes" onPress={()=>ui?.history()}/></View>{error&&<Copy error>{error}</Copy>}</>:<View style={styles.row}><Action label="Select" disabled={org.offline} onPress={()=>setSelecting(true)}/><Action label="Manage" disabled={org.offline} onPress={()=>ui?.manage()}/><Action label="Recent changes" onPress={()=>ui?.history()}/></View>}{editing&&snapshot&&<BulkEditor selection={snapshot} onClose={()=>setEditing(false)} onDone={()=>{setEditing(false);ui?.history();}}/>}</View>;
 return {selecting,ids,toggle,controls,supported};
}
