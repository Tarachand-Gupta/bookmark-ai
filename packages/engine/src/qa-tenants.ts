import { createHash, randomUUID } from 'node:crypto';
import { assertQaTenantName, createDb, runMigrations, TENANT_MIGRATIONS, type PostgresMasterRepository, type Tenant } from '@bookmark-ai/db';
import type { TenantPlatform } from './tenants';

export class TenantOperationPendingError extends Error {}
export function qaTenantDbName(accountId:string){return `bmai-sbqa-${createHash('sha256').update(accountId).digest('hex').slice(0,32)}`;}

async function claim(master:PostgresMasterRepository,id:string,kind:'provision'|'delete'){
  const lease=randomUUID();const name=qaTenantDbName(id);assertQaTenantName(name);
  const rows=await master.connection.query("update bmai_qa.tenant_operations set lease_id=$2,lease_until=now()+interval '120 seconds',updated_at=now() where account_id=$1 and kind=$3 and (lease_until is null or lease_until<now()) returning *",[id,lease,kind]);
  if(!rows[0])throw new TenantOperationPendingError('Tenant operation in progress');return {lease,operation:rows[0]};
}
async function stage(master:PostgresMasterRepository,id:string,lease:string,next:string,kind:'provision'|'delete',owned?:boolean){
  const rows=await master.connection.query('update bmai_qa.tenant_operations set stage=$3,owned=coalesce($4,owned),updated_at=now() where account_id=$1 and lease_id=$2 and lease_until>now() and kind=$5 returning account_id',[id,lease,next,owned??null,kind]);
  if(!rows.length)throw new TenantOperationPendingError('Tenant operation lease expired');
}
async function release(master:PostgresMasterRepository,id:string,lease:string){await master.connection.query('update bmai_qa.tenant_operations set lease_id=null,lease_until=null where account_id=$1 and lease_id=$2',[id,lease]);}

/** Persist receipts before remote work; failed operations remain retryable. */
export async function provisionQaTenant(master:PostgresMasterRepository,platform:TenantPlatform,id:string):Promise<Tenant>{
  const existing=await master.getTenant(id);
  if(existing?.status==='active'){
    if (existing.legacyOwnerId) {
      const active=await master.connection.query("select id from bmai_qa.accounts where id=$1 and state='active'",[id]);
      if (!active.length) throw new TenantOperationPendingError('Account not active');
      return existing;
    }
    // Recover only our exact durable creation receipt. Never adopt an active
    // tenant merely because its URL/name happens to match a QA namespace.
    const {lease,operation}=await claim(master,id,'provision');
    try {
      if(!operation.owned || operation.db_name!==existing.dbName || existing.dbName!==qaTenantDbName(id))
        throw new TenantOperationPendingError('Active tenant lacks exact recorded ownership');
      const active=await master.connection.query("select id from bmai_qa.accounts where id=$1 and state='active'",[id]);
      if(!active.length)throw new TenantOperationPendingError('Account not active');
      await stage(master,id,lease,'complete','provision');
      return existing;
    } finally { await release(master,id,lease); }
  }
  const name=qaTenantDbName(id);
  await master.connection.query("insert into bmai_qa.tenant_operations(account_id,kind,db_name) select $1,'provision',$2 where exists(select 1 from bmai_qa.accounts where id=$1 and state='active') on conflict(account_id) do nothing",[id,name]);
  const {lease,operation}=await claim(master,id,'provision');
  try{
    assertQaTenantName(String(operation.db_name));
    await stage(master,id,lease,'create-requested','provision');
    const database=await platform.createDatabase(name);
    if(database.name!==name)throw new Error("Turso returned a different database");
    // A preexisting DB is never adopted without a durable successful-creation receipt.
    // Ambiguous crash between remote create and receipt needs explicit reconciliation.
    if(!database.created&&!operation.owned)throw new TenantOperationPendingError('Unconfirmed database ownership; reconciliation required');
    await stage(master,id,lease,'created','provision',true);
    const token=await platform.createToken(name,{authorization:'full-access'});
    const url=database.hostname.startsWith('file:')?database.hostname:`libsql://${database.hostname}`;
    if(!url.startsWith("file:")){const host=new URL(url).hostname;if(!host.startsWith(`${name}-`)&&!host.startsWith(`${name}.`))throw new Error("Turso hostname outside QA namespace");if(!host.endsWith(".turso.io"))throw new Error("Untrusted tenant hostname");}
    const db=createDb(url,url.startsWith('file:')?undefined:token);
    try{await runMigrations(db,TENANT_MIGRATIONS);}finally{db.close();}
    await stage(master,id,lease,'migrated','provision');
    const saved=await master.insertTenant({clerkUserId:id,dbName:name,dbUrl:url,dbAuthToken:token,status:'active',plan:'free',createdAt:new Date().toISOString()});
    await stage(master,id,lease,'complete','provision');return saved;
  }finally{await release(master,id,lease);}
}

/** Mark deletion durably before erasing either provider's records. */
export async function beginQaAccountDeletion(master:PostgresMasterRepository,id:string,providerSubject?:string){
  return master.connection.transaction(async db=>{
    await db.query('select id from bmai_qa.accounts where id=$1 for update',[id]);
    const imported=await db.query('select account_id from bmai_qa.legacy_imports where account_id=$1',[id]);
    if (imported.length) throw new TenantOperationPendingError('Imported library deletion requires explicit ownership review');
    const rows=await db.query("update bmai_qa.accounts set state='deleting' where id=$1 and state in ('active','deleting') returning id",[id]);
    if(!rows.length)throw new TenantOperationPendingError('Account not active');
    await db.query("update bmai_qa.tenants set status='deleting' where account_id=$1",[id]);
    await db.query("insert into bmai_qa.tenant_operations(account_id,kind,db_name,owned,provider_subject) values($1,'delete',$2,false,$3) on conflict(account_id) do update set kind='delete',stage='pending',provider_subject=coalesce(excluded.provider_subject,bmai_qa.tenant_operations.provider_subject),updated_at=now()",[id,qaTenantDbName(id),providerSubject??null]);
  });
}
export async function deleteQaTenant(master:PostgresMasterRepository,platform:TenantPlatform,id:string){
  const {lease,operation}=await claim(master,id,'delete');
  try{
    const tenant=await master.getTenant(id);const name=String(operation.db_name);assertQaTenantName(name);
    if(tenant&&tenant.dbName!==name)throw new Error('Tenant ownership mismatch');
    if(operation.owned){await platform.deleteDatabase(name);await stage(master,id,lease,'database-deleted','delete');}
    else if(tenant)throw new TenantOperationPendingError('Deletion requires recorded database ownership');
    await master.deleteTenant(id);await stage(master,id,lease,'content-deleted','delete');
  }finally{await release(master,id,lease);}
}
