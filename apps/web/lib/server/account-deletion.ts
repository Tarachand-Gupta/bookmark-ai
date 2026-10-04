import { createClient } from '@supabase/supabase-js';
import { isPostgresMasterRepository } from '@bookmark-ai/db';
import { beginQaAccountDeletion, deleteQaTenant } from '@bookmark-ai/engine';
import { getMasterContext, getPlatform } from './context';

/** Retryable erasure; operation/ownership receipts survive provider-user deletion. */
export async function resumeAccountDeletion(accountId:string,providerUserId:string){
  const master=getMasterContext();const platform=getPlatform();
  if(!master||!isPostgresMasterRepository(master.db)||!platform||!process.env.SUPABASE_SECRET_KEY||!process.env.SUPABASE_URL)throw new Error('Account deletion not configured');
  await master.ready;
  await deleteQaTenant(master.db,platform,accountId);
  const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {error}=await client.auth.admin.deleteUser(providerUserId);
  if(error&&error.status!==404)throw new Error('Identity deletion temporarily unavailable');
  await master.db.connection.transaction(async db=>{
    await db.query('delete from bmai_qa.usage where account_id=$1',[accountId]);
    await db.query("update bmai_qa.accounts set state='deleted' where id=$1",[accountId]);
    await db.query("update bmai_qa.tenant_operations set stage='complete',updated_at=now() where account_id=$1 and kind='delete'",[accountId]);
  });
}
export async function startAccountDeletion(accountId:string,providerUserId:string,current:string){
  const master=getMasterContext();if(!master||!isPostgresMasterRepository(master.db)||!getPlatform()||!process.env.SUPABASE_SECRET_KEY)throw new Error('Account deletion not configured');
  await beginQaAccountDeletion(master.db,accountId,providerUserId);
  await master.db.manageSessions(providerUserId,current,'global');
  // Record provider subject before deleting auth.users cascades the identity mapping.
  await master.db.connection.query("update bmai_qa.tenant_operations set provider_subject=$2 where account_id=$1 and kind='delete'",[accountId,providerUserId]);
  await resumeAccountDeletion(accountId,providerUserId);
}
