import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {ActivityIndicator,Alert,AppState,BackHandler,Keyboard,Platform,Pressable,ScrollView,Text,useWindowDimensions,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {mobileCache} from '../lib/mobile-cache';
import {useCachedResource} from '../hooks/useCachedResource';
import * as Crypto from 'expo-crypto';
import type {ChatContext} from '@bookmark-ai/types';
import type {UIMessage} from 'ai';
import {getApiUrl,getChatConversation} from '../api';
import {useAiChat,type AiChatState} from '../hooks/useAiChat';
import {useChatAttachments,type ChatAttachmentsState} from '../hooks/useChatAttachments';
import {useKeyboardOverlap} from '../hooks/useKeyboardOverlap';
import {useAppTheme} from './PreferencesContext';
import {AUTH_NAMESPACE} from "../lib/auth-config";
import {useWorkspace} from "./WorkspaceContext";
import {useOrganization} from './OrganizationContext';
import {contextLabel,freshDraft,hasDraft,recoverDrafts,serializeDrafts,type ComposerDraft} from '../lib/composer-state';
import {toFileParts} from '../lib/chatAttachments';
import {ChatComposer} from '../components/chat/ChatComposer';
import {ChatThread} from '../components/chat/ChatThread';
import {Action,Copy,styles} from '../components/organization/OrganizationSheet';
const EMPTY_ATTACHMENTS:ChatAttachmentsState={items:[],error:null,busy:false,pickPhotos:()=>{},pickFiles:()=>{},remove:()=>{},clear:()=>{},dismissError:()=>{}};
interface Runtime {chat:AiChatState;attachments:ChatAttachmentsState;}
interface Composer {open:(context?:ChatContext)=>void;openExisting:(id:string,title:string)=>void;newChat:()=>void;close:()=>void;expanded:boolean;paneWidth:number;block:(key:string,value:boolean)=>void;historyRevision:number;}
const Context=createContext<Composer|null>(null);
export function useComposer(){const value=useContext(Context);if(!value)throw new Error('ComposerProvider missing');return value;}
export function ComposerProvider({children}:{children:ReactNode}) {
 const workspace=useWorkspace();
 const {colors}=useAppTheme(),org=useOrganization(),insets=useSafeAreaInsets(),{width,fontScale}=useWindowDimensions(),keyboard=useKeyboardOverlap();
 const [runtimeErrors,setRuntimeErrors]=useState<Record<string,{error:string|null;retry:()=>void}>>({});
 const [drafts,setDrafts]=useState<ComposerDraft[]>([]),[active,setActive]=useState(''),[expanded,setExpanded]=useState(false),[blocked,setBlocked]=useState<string[]>([]),[revision,setRevision]=useState(0),[historyRevision,setHistoryRevision]=useState(0),[switcher,setSwitcher]=useState(false),[hydrated,setHydrated]=useState(false);
 const runtimes=useRef(new Map<string,Runtime>()),draftRef=useRef(drafts);draftRef.current=drafts;
 const update=useCallback((key:string,patch:Partial<ComposerDraft>)=>setDrafts(prev=>prev.map(d=>d.key===key?{...d,...patch}:d)),[]);
 const wide=width>=1000&&fontScale<=1.4,paneWidth=expanded&&wide?Math.min(460,width*.46):0;
 const cacheEpoch=useRef(mobileCache.epoch(workspace.scope));
 useEffect(()=>{let live=true;setHydrated(false);void mobileCache.read<string>(workspace.scope,'composer-drafts').then(saved=>{if(!live)return;const restored=saved?recoverDrafts(saved.data):[];const initial=restored.length?restored:[freshDraft(Crypto.randomUUID())];setDrafts(initial);setActive(initial[0].key);setHydrated(true)});return()=>{live=false}},[workspace.scope.accountId,workspace.scope.origin]);
 useEffect(()=>{if(!hydrated)return;const payload=serializeDrafts(drafts);const timer=setTimeout(()=>void mobileCache.write(workspace.scope,'composer-drafts',payload,cacheEpoch.current),200);return()=>clearTimeout(timer)},[drafts,hydrated,workspace.scope.accountId,workspace.scope.origin]);
 const create=useCallback((context:ChatContext={type:'library'})=>{const next=freshDraft(Crypto.randomUUID(),context);setDrafts(prev=>[...prev,next]);setActive(next.key);setExpanded(true);setSwitcher(false)},[]);
 const close=useCallback(()=>{Keyboard.dismiss();setExpanded(false);setSwitcher(false)},[]);
 const open=useCallback((context?:ChatContext)=>{setExpanded(true);const current=draftRef.current.find(d=>d.key===active);if(!current){create(context);return;}if(!context)return;if(current.contextUnavailable){update(active,{context:structuredClone(context),contextUnavailable:false});return;}if(JSON.stringify(context)===JSON.stringify(current.context))return;if(hasDraft(current)||runtimes.current.get(active)?.chat.messages.length){Alert.alert('Use a different context?','Keep this chat and its draft, start a new chat for the selection, or explicitly replace the next-message context.',[{text:'Keep current',style:'cancel'},{text:'New chat',onPress:()=>create(context)},{text:'Use for next message',onPress:()=>update(active,{context:structuredClone(context)})}]);}else update(active,{context:structuredClone(context)});},[active,create,update]);
 const openExisting=useCallback((id:string,title:string)=>{const found=draftRef.current.find(d=>d.conversationId===id);if(found){setActive(found.key);setExpanded(true);return;}const draft={...freshDraft(Crypto.randomUUID()),conversationId:id,title};setDrafts(prev=>[...prev,draft]);setActive(draft.key);setExpanded(true);},[]);
 const block=useCallback((key:string,value:boolean)=>setBlocked(prev=>value?(prev.includes(key)?prev:[...prev,key]):prev.filter(v=>v!==key)),[]);
 const publish=useCallback((key:string,runtime:Runtime)=>{runtimes.current.set(key,runtime);setRevision(n=>n+1);setDrafts(prev=>prev.map(d=>d.key===key&&(d.attachmentCount!==runtime.attachments.items.length||d.conversationId!==runtime.chat.conversationId)?{...d,attachmentCount:runtime.attachments.items.length,conversationId:runtime.chat.conversationId}:d));},[]);
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state!=='background')return;for(const[key,runtime]of runtimes.current){if(runtime.chat.status==='streaming'||runtime.chat.status==='submitted'){runtime.chat.stop();update(key,{interrupted:true});}}void mobileCache.write(workspace.scope,'composer-drafts',serializeDrafts(draftRef.current),cacheEpoch.current);});return()=>sub.remove()},[update,workspace.scope.accountId,workspace.scope.origin]);
 useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(!expanded)return false;if(Keyboard.isVisible()){Keyboard.dismiss();return true;}close();return true;});return()=>sub.remove()},[expanded,close]);
 const effectiveBlocked=blocked.filter(key=>!expanded||!key.startsWith("selection-"));
 const publishError=useCallback((key:string,value:{error:string|null;retry:()=>void})=>setRuntimeErrors(prev=>({...prev,[key]:value})),[]);
 const draft=drafts.find(d=>d.key===active),runtime=runtimes.current.get(active);
 const send=(text:string)=>{if(!runtime||!draft||draft.contextUnavailable||workspace.readOnly||org.offline)return;runtime.chat.send(text,toFileParts(runtime.attachments.items),structuredClone(draft.context));runtime.attachments.clear();update(active,{text:'',title:draft.title==='New chat'?text.trim().slice(0,60)||'New chat':draft.title,interrupted:false,lostAttachments:false});};
 const bottom=expanded?(Platform.OS==='android'?keyboard+insets.bottom:Math.max(keyboard,insets.bottom)):88;
 return <Context.Provider value={{open,openExisting,newChat:()=>create(),close,expanded,paneWidth,block,historyRevision}}>{children}
 {drafts.map(d=><RuntimeHost key={d.key} draftKey={d.key} initialId={d.conversationId} publish={publish} publishError={publishError} onFinished={()=>setHistoryRevision(n=>n+1)}/>)}
 {hydrated&&draft&&<View pointerEvents={effectiveBlocked.length?'none':'auto'} accessibilityElementsHidden={effectiveBlocked.length>0} importantForAccessibility={effectiveBlocked.length?'no-hide-descendants':'auto'} style={{position:'absolute',right:expanded?0:12,left:expanded?(wide?width-paneWidth:0):12,top:expanded?0:undefined,bottom:expanded?0:bottom,display:effectiveBlocked.length?'none':'flex',backgroundColor:colors.background,borderRadius:expanded?0:18,borderWidth:1,borderColor:colors.border,paddingTop:expanded?insets.top:0,paddingBottom:expanded?bottom:0,zIndex:20}}>
 <View style={{display:expanded?'flex':'none',flex:1}}>
 <View style={{padding:12,flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:8}}><Action label="Back" onPress={close}/><Text numberOfLines={1} style={{flex:1,minWidth:90,fontWeight:'600',color:colors.foreground,fontSize:17}}>{draft.title}</Text><Action label="Chats" onPress={()=>setSwitcher(v=>!v)}/><Action label="New chat" onPress={()=>create()}/></View>
 {switcher&&<ScrollView style={{maxHeight:180}} contentContainerStyle={{padding:12,gap:8}}>{drafts.map(d=><Action key={d.key} label={`${d.title}${d.text?' · draft':''}`} onPress={()=>{setActive(d.key);setSwitcher(false)}}/>)}</ScrollView>}
 <View style={{paddingHorizontal:16,gap:7,paddingBottom:8}}><Pressable accessibilityRole="button" accessibilityLabel="Change chat context" onPress={()=>Alert.alert('Next-message context',contextLabel(draft.context),[{text:'Keep current',style:'cancel'},{text:'Whole library',onPress:()=>open({type:'library'})}])}><Text style={{color:colors.foreground,fontSize:14}}>{draft.contextUnavailable?"Choose bookmark context":contextLabel(draft.context)} · Change</Text></Pressable><Copy>{workspace.readOnly||org.offline?"Reconnect and restore sign-in to send. Your draft stays on this device.":"Find, compare and summarize saved links. Use Organize for manual changes."}</Copy>{draft.contextUnavailable&&<Copy error>Your draft was kept. Choose Whole library or select bookmarks before sending.</Copy>}{draft.lostAttachments&&<Copy error>Reattach your files after restarting the app. Your message and context were restored.</Copy>}{draft.interrupted&&<Copy error>The response was interrupted when the app went into the background. Check the reply before retrying.</Copy>}</View>
 {runtime?<ChatThread key={draft.key} chat={runtime.chat} onPick={text=>update(active,{text})}/>:runtimeErrors[active]?.error?<View style={{flex:1,padding:20,gap:12}}><Copy error>{runtimeErrors[active].error}</Copy><Copy>Your draft is still available below.</Copy><Action label='Retry loading chat' onPress={runtimeErrors[active].retry}/></View>:<ActivityIndicator style={{flex:1}} color={colors.mutedForeground}/>}
 </View>
 <ChatComposer available={!!runtime&&!draft.contextUnavailable&&!workspace.readOnly&&!org.offline} streaming={runtime?.chat.status==='streaming'||runtime?.chat.status==='submitted'} onSend={send} onStop={()=>runtime?.chat.stop()} attachments={runtime?.attachments??EMPTY_ATTACHMENTS} draft={draft.text} onDraftChange={text=>update(active,{text})} onActivate={()=>setExpanded(true)} compact={!expanded} placeholder="Ask about your library…"/>
 </View>}
 </Context.Provider>;
}
function RuntimeHost({draftKey,initialId,publish,publishError,onFinished}:{draftKey:string;initialId:string|null;publish:(key:string,runtime:Runtime)=>void;publishError:(key:string,value:{error:string|null;retry:()=>void})=>void;onFinished:()=>void}){
 const initial=useRef(initialId);
 return initial.current?<ExistingRuntime draftKey={draftKey} id={initial.current} publish={publish} publishError={publishError} onFinished={onFinished}/>:<RuntimeReady draftKey={draftKey} initialId={null} messages={[]} publish={publish} onFinished={onFinished}/>;
}
function ExistingRuntime({draftKey,id,publish,publishError,onFinished}:{draftKey:string;id:string;publish:(key:string,runtime:Runtime)=>void;publishError:(key:string,value:{error:string|null;retry:()=>void})=>void;onFinished:()=>void}){
 const resource=useCachedResource(`conversation:${id}`,()=>getChatConversation(id));
 const [messages,setMessages]=useState<UIMessage[]|null>(null);
 useEffect(()=>{if(messages===null&&resource.data)setMessages(resource.data.messages as unknown as UIMessage[])},[messages,resource.data]);
 useEffect(()=>{publishError(draftKey,{error:resource.error??(resource.readOnly&&!resource.data&&!resource.loading?'This conversation has not been saved on this device. Reconnect to load it.':null),retry:resource.refresh})},[draftKey,publishError,resource.error,resource.readOnly,resource.loading,resource.data,resource.refresh]);
 return messages?<RuntimeReady draftKey={draftKey} initialId={id} messages={messages} publish={publish} onFinished={onFinished}/>:null;
}
function RuntimeReady({draftKey,initialId,messages,publish,onFinished}:{draftKey:string;initialId:string|null;messages:UIMessage[];publish:(key:string,runtime:Runtime)=>void;onFinished:()=>void}){
 const {scope}=useWorkspace(),epoch=useRef(mobileCache.epoch(scope));
 const finish=useRef(onFinished);finish.current=onFinished;const stableFinish=useCallback(()=>finish.current(),[]);
 const chat=useAiChat({initialMessages:messages,conversationId:initialId,onFinish:stableFinish}),attachments=useChatAttachments();
 useEffect(()=>{publish(draftKey,{chat,attachments});},[draftKey,publish,chat.messages,chat.status,chat.error,chat.limit,chat.quota,chat.rejected,chat.aiSource,chat.aiNote,chat.conversationId,attachments.items,attachments.error,attachments.busy]);
 useEffect(()=>{if(chat.conversationId&&chat.messages.length&&chat.status!=='streaming'&&chat.status!=='submitted')void mobileCache.write(scope,`conversation:${chat.conversationId}`,{messages:chat.messages},epoch.current).catch(()=>undefined)},[chat.conversationId,chat.messages,chat.status]);
 return null;
}
