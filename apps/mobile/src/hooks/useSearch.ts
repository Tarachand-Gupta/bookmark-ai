import { useEffect, useState } from "react";
import type { Bookmark, Session, ListBookmarksResponse, ListSessionsResponse } from "@bookmark-ai/types";
import { searchBookmarks } from "../api";
import { useOrganization } from "../context/OrganizationContext";
import { useCachedResource } from "./useCachedResource";
import { resourceKey } from "../lib/snapshot-cache";
export interface SearchState {
  query: string; setQuery: (q: string) => void; matches: Bookmark[]; related: Bookmark[];
  sessions: Session[]; searching: boolean; keywordOnly: boolean; error: string | null; offline: boolean;
}
export function useSearch(): SearchState {
  const {revision}=useOrganization();
  const [query,setQuery]=useState(''),[settled,setSettled]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>setSettled(query.trim()),350);return()=>clearTimeout(timer)},[query]);
  const result=useCachedResource(resourceKey('search',{q:settled}),()=>searchBookmarks(settled,'hybrid'),true,!!settled);
  // These readers use the same account-scoped snapshots, without duplicate requests.
  const library=useCachedResource<ListBookmarksResponse>(resourceKey('library'),async()=>({bookmarks:[],total:0}),false,false);
  const savedSessions=useCachedResource<ListSessionsResponse>('sessions',async()=>({sessions:[]}),false,false);
  useEffect(()=>{if(settled)result.refresh()},[revision]);
  const offline=result.readOnly||!!result.error,terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const match=(text:string)=>terms.every(term=>text.toLocaleLowerCase().includes(term));
  const current=query.trim()===settled;
  const localMatches=terms.length?(library.data?.bookmarks??[]).filter(b=>match(`${b.title} ${b.url} ${b.category} ${b.tags.join(' ')}`)):[];
  const localSessions=terms.length?(savedSessions.data?.sessions??[]).filter(s=>match(`${s.name} ${s.tabs.map(t=>`${t.title} ${t.url}`).join(' ')}`)):[];
  return {query,setQuery,matches:offline&&!result.data?localMatches:current&&terms.length?(result.data?.results??[]).filter(r=>r.exact).map(r=>r.bookmark):[],related:current&&terms.length?(result.data?.results??[]).filter(r=>!r.exact).map(r=>r.bookmark):[],sessions:offline&&!result.data?localSessions:current&&terms.length?result.data?.sessionResults?.map(r=>r.session)??[]:[],searching:!!terms.length&&!offline&&(!current||result.refreshing),keywordOnly:offline||result.data?.fallback===true,error:result.error,offline};
}
