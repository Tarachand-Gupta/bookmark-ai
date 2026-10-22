import {useCallback,useEffect,useRef,useState} from 'react';
import type {Bookmark,MetaResponse} from '@bookmark-ai/types';
import {getMeta,listBookmarks,type LibraryFilters} from '../api';
import {useCachedResource} from './useCachedResource';
import {resourceKey} from '../lib/snapshot-cache';
const PAGE_SIZE=30;
export interface LibraryState {meta:MetaResponse|null;bookmarks:Bookmark[];total:number;loading:boolean;refreshing:boolean;error:string|null;updatedAt:number|null;readOnly:boolean;filters:LibraryFilters;activeFilterCount:number;setFilter:(key:keyof LibraryFilters,value:string|undefined)=>void;setFilterExact:(key:keyof LibraryFilters,value:string|undefined)=>void;clearFilters:()=>void;refresh:()=>void;loadMore:()=>void;}
export function useLibrary(active:boolean):LibraryState {
 const [filters,setFilters]=useState<LibraryFilters>({});
 const key=resourceKey('library',{...filters}),currentKey=useRef(key);currentKey.current=key;
 const resource=useCachedResource(key,()=>listBookmarks(filters,{limit:PAGE_SIZE,offset:0}),active),meta=useCachedResource('meta',getMeta,active);
 const loadingMore=useRef(false);
 const refresh=useCallback(()=>{resource.refresh();meta.refresh()},[resource.refresh,meta.refresh]);
 const loadMore=useCallback(()=>{if(loadingMore.current||resource.readOnly||resource.error||!resource.data||resource.data.bookmarks.length>=resource.data.total)return;loadingMore.current=true;const started=key,previous=resource.data;void listBookmarks(filters,{limit:PAGE_SIZE,offset:previous.bookmarks.length}).then(next=>{if(currentKey.current!==started)return;const seen=new Set(previous.bookmarks.map(b=>b.id));resource.replace({...next,bookmarks:[...previous.bookmarks,...next.bookmarks.filter(b=>!seen.has(b.id))]});}).catch(()=>undefined).finally(()=>{loadingMore.current=false});},[key,filters,resource.data,resource.readOnly,resource.error,resource.replace]);
 const setFilter=useCallback((key:keyof LibraryFilters,value:string|undefined)=>setFilters(prev=>({...prev,[key]:prev[key]===value?undefined:value})),[]);
 const setFilterExact=useCallback((key:keyof LibraryFilters,value:string|undefined)=>setFilters(prev=>prev[key]===value?prev:{...prev,[key]:value}),[]);
 return {meta:meta.data,bookmarks:resource.data?.bookmarks??[],total:resource.data?.total??0,loading:resource.loading,refreshing:resource.refreshing,error:resource.error,updatedAt:resource.updatedAt,readOnly:resource.readOnly,filters,activeFilterCount:Object.values(filters).filter(Boolean).length,setFilter,setFilterExact,clearFilters:useCallback(()=>setFilters({}),[]),refresh,loadMore};
}
