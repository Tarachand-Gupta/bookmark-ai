import { authMutationOriginAllowed } from "./auth-request-origin";
import { z } from 'zod';
import { isPostgresMasterRepository } from '@bookmark-ai/db';
import { NextResponse } from 'next/server';
import { getMasterContext } from './context';
import { requireUser } from './require-user';
import { readLimitedJson, MacAuthRequestError } from './macos-auth';

export const sessionClientTypes=['web','pwa','macos','ios','android','chrome-extension','firefox-extension','safari-extension'] as const;
export function cleanDeviceLabel(value:string):string{return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').replace(/<[^>]*>/g,'').trim();}
const label=z.string().max(80).transform(cleanDeviceLabel);
export const sessionMetadataSchema=z.object({clientType:z.enum(sessionClientTypes),deviceName:label.optional(),browser:label.optional(),os:label.optional(),appVersion:z.string().max(40).transform(cleanDeviceLabel).optional()}).strict();
export const sessionRenameSchema=z.object({displayName:label.refine(v=>v.length>0)}).strict();
export const sessionScopeSchema=z.object({scope:z.enum(['local','others','global'])}).strict();

export async function sessionAction(request:Request,operation:'list'|'register'|'rename'|'revoke'|'sign-out',target?:string){
  if(operation!=="list"&&!authMutationOriginAllowed(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const gate=await requireUser();if(!gate.ok)return gate.response;
  if(!gate.identity)return NextResponse.json({error:'Supabase session required'},{status:400});
  if(target&&!z.string().uuid().safeParse(target).success)return NextResponse.json({error:'Session not found'},{status:404});
  try{
    const master=getMasterContext();if(!master||!isPostgresMasterRepository(master.db))throw new Error();await master.ready;
    let metadata:Record<string,unknown>={};let action:string=operation;
    if(operation==='register'){
      const input=sessionMetadataSchema.parse(await readLimitedJson(request,2048));
      metadata={...input,displayName:input.deviceName||`${input.clientType} device`};
      // OAuth client classification controls permissions; this optional map is display only.
      if(gate.identity.clientId){
        let types:Record<string,unknown>={};try{types=JSON.parse(process.env.SUPABASE_EXTENSION_CLIENT_TYPES??'{}');}catch{}
        const inferred=types[String(gate.identity.clientId)];
        metadata.clientType=sessionClientTypes.includes(inferred as any)?inferred:'chrome-extension';
      }
    }
    if(operation==='rename')metadata=sessionRenameSchema.parse(await readLimitedJson(request,1024));
    if(operation==='sign-out'){
      action=sessionScopeSchema.parse(await readLimitedJson(request,512)).scope;
      if(gate.identity.clientId && action!=='local')return NextResponse.json({error:'Extension may only sign out its current session',code:'token-scope'},{status:403});
    }
    const result=await master.db.manageSessions(gate.identity.providerUserId,gate.identity.sessionId,action,target??null,metadata);
    if(operation==='revoke'){return result?new NextResponse(null,{status:204}):NextResponse.json({error:'Session not found'},{status:404});}
    if(operation==='rename'&&result===null)return NextResponse.json({error:'Session not found'},{status:404});
    if(operation==='sign-out')return new NextResponse(null,{status:204});
    if(operation==='register')return NextResponse.json({session:result.find((s:any)=>s.isCurrent)},{headers:{'cache-control':'no-store'}});
    return NextResponse.json({sessions:result},{headers:{'cache-control':'no-store'}});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:'Invalid session metadata'},{status:400});
    if(error instanceof MacAuthRequestError)return NextResponse.json({error:error.message},{status:error.status});
    if((error as any)?.code==='28000')return NextResponse.json({error:'Session expired'},{status:401});
    return NextResponse.json({error:'Session service temporarily unavailable'},{status:503});
  }
}
