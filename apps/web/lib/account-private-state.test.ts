import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceExplicitSignOut, clearAccountPrivateStorage, onExplicitSignOut, PRIVATE_SIGN_OUT_EVENT, PRIVATE_SIGN_OUT_STORAGE } from "./account-private-state";
let values: Map<string,string>;
beforeEach(() => { values=new Map(); vi.stubGlobal("window",new EventTarget()); vi.stubGlobal("localStorage",{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}); vi.stubGlobal("BroadcastChannel",class { postMessage=vi.fn(); close=vi.fn(); onmessage=null; }); });
afterEach(()=>vi.unstubAllGlobals());
describe("explicit private-state cleanup",()=>{
  it("clears only the explicitly signed-out account's drafts, batches and pending requests",()=>{
    for(const prefix of ["bmai:composer:v1:","bmai:organization-batches:v1:","bmai:organization-request:v1:","bmai:save-request:v1:"]){values.set(prefix+"a","private-a");values.set(prefix+"b","private-b");}
    const a=vi.fn();const b=vi.fn();const stopA=onExplicitSignOut("a",a);const stopB=onExplicitSignOut("b",b);announceExplicitSignOut("a");
    expect(a).toHaveBeenCalledOnce();expect(b).not.toHaveBeenCalled();expect([...values.keys()].filter(k=>k.endsWith(":a"))).toHaveLength(0);expect([...values.keys()].filter(k=>k.endsWith(":b"))).toHaveLength(4);stopA();stopB();
  });
  it("receives another tab's account signal once and ignores auth-expiry events",()=>{
    const clear=vi.fn();const stop=onExplicitSignOut("a",clear);window.dispatchEvent(new Event("SIGNED_OUT"));expect(clear).not.toHaveBeenCalled();
    const event=Object.assign(new Event("storage"),{key:PRIVATE_SIGN_OUT_STORAGE,newValue:JSON.stringify({accountId:"a"})});window.dispatchEvent(event);window.dispatchEvent(new CustomEvent(PRIVATE_SIGN_OUT_EVENT,{detail:{accountId:"a"}}));expect(clear).toHaveBeenCalledOnce();stop();
  });
  it("restricted storage cannot stop in-memory cleanup",()=>{
    expect(()=>clearAccountPrivateStorage({removeItem(){throw Error("blocked");}},"a")).not.toThrow();const clear=vi.fn();const stop=onExplicitSignOut("a",clear);vi.stubGlobal("localStorage",{get setItem(){throw Error("blocked");},removeItem(){throw Error("blocked");}});announceExplicitSignOut("a");expect(clear).toHaveBeenCalledOnce();stop();
  });
});
