import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {Alert} from 'react-native';
import * as Crypto from 'expo-crypto';
import type {Bookmark,ReadingState} from '@bookmark-ai/types';
import {useOrganization} from './OrganizationContext';
import {useComposer} from './ComposerContext';
import {BookmarkEditor} from '../components/organization/BookmarkEditor';
import {ManageOrganization} from '../components/organization/ManageOrganization';
import {RecentChanges} from '../components/organization/RecentChanges';
interface Ui {edit:(bookmark:Bookmark)=>void;manage:()=>void;history:()=>void;reading:(bookmark:Bookmark,state:ReadingState)=>void;}
const Context=createContext<Ui|null>(null);
export function useOrganizationUi(){return useContext(Context);}
export function OrganizationUiProvider({children}:{children:ReactNode}){
 const org=useOrganization(),composer=useComposer();const [bookmark,setBookmark]=useState<Bookmark|null>(null),[screen,setScreen]=useState<'manage'|'history'|null>(null);
 useEffect(()=>{composer.block('organization',!!bookmark||!!screen);return()=>composer.block('organization',false)},[bookmark,screen,composer.block]);
 const reading=useCallback((bookmark:Bookmark,state:ReadingState)=>{void org.execute('Change reading status',[{path:`/api/bookmarks/${encodeURIComponent(bookmark.id)}`,method:'PATCH',body:{operationId:Crypto.randomUUID(),changes:{readingState:state},expected:bookmark.fieldVersions??{}}}]).then(job=>{const result=job.receipts[0];if(job.status!=='completed'||result?.failedCount)Alert.alert('Reading status not confirmed',job.error??result?.results.find(r=>r.error)?.error?.message??'Open Recent changes to check this request.');}).catch(e=>Alert.alert('Could not change reading status',e.message));},[org.execute]);
 return <Context.Provider value={{edit:setBookmark,manage:()=>setScreen('manage'),history:()=>setScreen('history'),reading}}>{children}{bookmark&&<BookmarkEditor key={bookmark.id} bookmark={bookmark} onClose={()=>setBookmark(null)}/>} {screen==='manage'&&<ManageOrganization onClose={()=>setScreen(null)}/>} {screen==='history'&&<RecentChanges onClose={()=>setScreen(null)}/>}</Context.Provider>;
}
