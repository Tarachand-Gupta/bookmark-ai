import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import type {Bookmark} from '@bookmark-ai/types';
import {useComposer} from './ComposerContext';
import {BookmarkEditor} from '../components/organization/BookmarkEditor';
import {ManageOrganization} from '../components/organization/ManageOrganization';
import {RecentChanges} from '../components/organization/RecentChanges';
interface Ui {edit:(bookmark:Bookmark)=>void;manage:()=>void;history:()=>void;}
const Context=createContext<Ui|null>(null);
export function useOrganizationUi(){return useContext(Context);}
export function OrganizationUiProvider({children}:{children:ReactNode}){
 const composer=useComposer();const [bookmark,setBookmark]=useState<Bookmark|null>(null),[screen,setScreen]=useState<'manage'|'history'|null>(null);
 useEffect(()=>{composer.block('organization',!!bookmark||!!screen);return()=>composer.block('organization',false)},[bookmark,screen,composer.block]);
 return <Context.Provider value={{edit:setBookmark,manage:()=>setScreen('manage'),history:()=>setScreen('history')}}>{children}{bookmark&&<BookmarkEditor key={bookmark.id} bookmark={bookmark} onClose={()=>setBookmark(null)}/>} {screen==='manage'&&<ManageOrganization onClose={()=>setScreen(null)}/>} {screen==='history'&&<RecentChanges onClose={()=>setScreen(null)}/>}</Context.Provider>;
}
