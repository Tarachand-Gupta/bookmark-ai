import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { isPostgresMasterRepository } from '@bookmark-ai/db';
import { provisionQaTenant } from '@bookmark-ai/engine';
import { getMasterContext,getPlatform } from '@/lib/server/context';
import { resumeAccountDeletion } from '@/lib/server/account-deletion';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const expected=process.env.CRON_SECRET;const presented=request.headers.get('authorization')??'';
  const a=Buffer.from(presented),b=Buffer.from(`Bearer ${expected}`);
  if(!expected||a.length!==b.length||!timingSafeEqual(a,b))return NextResponse.json({error:'Unauthorized'},{status:401});
  const master=getMasterContext(),platform=getPlatform();if(!master||!isPostgresMasterRepository(master.db)||!platform)return NextResponse.json({error:'Not configured'},{status:503});
  try{
    const rows=await master.db.connection.query("select account_id,kind,provider_subject from bmai_qa.tenant_operations where stage<>'complete' and (lease_until is null or lease_until<now()) order by updated_at limit 20");
    let complete=0,failed=0;
    for(const row of rows){try{if(row.kind==='provision')await provisionQaTenant(master.db,platform,String(row.account_id));else if(row.provider_subject)await resumeAccountDeletion(String(row.account_id),String(row.provider_subject));else throw new Error();complete++;}catch{failed++;}}
    return NextResponse.json({complete,failed});
  }catch{return NextResponse.json({error:'Operation recovery unavailable'},{status:503});}
}
