import { authMutationOriginAllowed } from "@/lib/server/auth-request-origin";
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/server/require-user';
import { cleanDeviceLabel } from '@/lib/server/session-management';
import { readLimitedJson } from '@/lib/server/macos-auth';
export async function PATCH(request:Request){
  if(!authMutationOriginAllowed(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const gate=await requireUser();if(!gate.ok)return gate.response;
  if(!gate.identity)return NextResponse.json({error:'Supabase session required'},{status:400});
  try{
    const input=z.object({displayName:z.string().max(80).transform(cleanDeviceLabel)}).strict().parse(await readLimitedJson(request,1024));
    const response=await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`,{method:'PUT',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY??'',authorization:`Bearer ${gate.identity.accessToken}`,'content-type':'application/json'},body:JSON.stringify({data:{full_name:input.displayName}}),signal:AbortSignal.timeout(8000),cache:'no-store'});
    if(!response.ok)return NextResponse.json({error:'Profile update unavailable'},{status:response.status===401?401:503});
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof z.ZodError?'Invalid profile':'Profile update unavailable'},{status:error instanceof z.ZodError?400:503});}
}
