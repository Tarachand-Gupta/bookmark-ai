import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { CredentialCipher } from './credential-cipher';
import type { MasterRepository } from './master-repository';
import type { Tenant, UsageField } from './master';
import type { AppReleaseRow } from './queries/app-releases';
import type { CreateMacAuthFlow, MacAuthFlow } from './queries/macos-auth';

type Row = Record<string, any>;
/** Injectable connection boundary for real Postgres and security-focused tests. */
export interface PgExecutor {
  query(sql: string, args?: unknown[]): Promise<Row[]>;
  transaction<T>(work: (db: PgExecutor) => Promise<T>): Promise<T>;
}
export function connectPostgres(url: string, options:{caBase64?:string}={}): PgExecutor {
  const ca=options.caBase64 ? Buffer.from(options.caBase64,'base64').toString('utf8') : undefined;
  if(options.caBase64&&!ca?.includes('-----BEGIN CERTIFICATE-----'))throw new Error('Invalid Supabase database CA certificate');
  const client = postgres(url, { max: 3, prepare: false, connect_timeout: 8, idle_timeout: 20, ssl: {rejectUnauthorized:true,...(ca?{ca}:{})} });
  const wrap = (sql: any): PgExecutor => ({
    query: async (query, args = []) => [...await sql.unsafe(query, args)],
    transaction: (work) => sql.begin((tx: any) => work(wrap(tx))),
  });
  return wrap(client);
}
const iso = (value: any): string => value instanceof Date ? value.toISOString() : String(value);
export class PostgresMasterRepository implements MasterRepository {
  readonly kind = 'postgres' as const;
  constructor(readonly connection: PgExecutor, private readonly cipher: CredentialCipher) {}
  async ready(): Promise<void> { await this.connection.query('select id from bmai_qa.accounts limit 0'); }
  async resolveAccount(subject: string): Promise<string> {
    return this.connection.transaction(async (db) => {
      // Transaction-scoped lock handles the no-row-yet identity race.
      await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`supabase:${subject}`]);
      const rows = await db.query("select a.id,a.state from bmai_qa.identities i join bmai_qa.accounts a on a.id=i.account_id where i.provider='supabase' and i.subject=$1", [subject]);
      if (rows[0]) {
        if (rows[0].state !== 'active') throw new AccountDisabledError();
        return String(rows[0].id);
      }
      const id = randomUUID();
      await db.query('insert into bmai_qa.accounts(id) values($1)', [id]);
      await db.query("insert into bmai_qa.identities(provider,subject,account_id) values('supabase',$1,$2)", [subject,id]);
      return id;
    });
  }
  async lookupAccount(subject: string): Promise<string | null> {
    const rows=await this.connection.query("select a.id from bmai_qa.identities i join bmai_qa.accounts a on a.id=i.account_id where i.provider='supabase' and i.subject=$1 and a.state='active'",[subject]);
    return rows[0] ? String(rows[0].id) : null;
  }
  private tenant(row: Row): Tenant {
    const id=String(row.account_id);
    return {clerkUserId:id,dbName:String(row.db_name),dbUrl:String(row.db_url),dbAuthToken:this.cipher.decrypt(String(row.credential_ciphertext),id),status:String(row.status),plan:String(row.plan),createdAt:iso(row.created_at)};
  }
  async getTenant(id: string): Promise<Tenant|null> {
    const rows=await this.connection.query('select * from bmai_qa.tenants where account_id=$1',[id]);
    return rows[0] ? this.tenant(rows[0]) : null;
  }
  async insertTenant(t: Tenant): Promise<Tenant> {
    assertQaTenantName(t.dbName);
    await this.connection.query("insert into bmai_qa.tenants(account_id,db_name,db_url,credential_ciphertext,status,plan,created_at) select $1,$2,$3,$4,$5,$6,$7 where exists(select 1 from bmai_qa.accounts where id=$1 and state='active')",[t.clerkUserId,t.dbName,t.dbUrl,this.cipher.encrypt(t.dbAuthToken,t.clerkUserId),t.status,t.plan,t.createdAt]);
    const saved=await this.getTenant(t.clerkUserId); if(!saved) throw new AccountDisabledError(); return saved;
  }
  async deleteTenant(id:string) {return (await this.connection.query('delete from bmai_qa.tenants where account_id=$1 returning account_id',[id])).length>0;}
  async listActiveTenants(){return (await this.connection.query("select t.* from bmai_qa.tenants t join bmai_qa.accounts a on a.id=t.account_id where t.status='active' and a.state='active' order by t.created_at")).map(r=>this.tenant(r));}
  async getPlatformConfig(key:string){const r=await this.connection.query('select value from bmai_qa.platform_config where key=$1',[key]);return r[0]?String(r[0].value):null;}
  async setPlatformConfig(key:string,value:string){await this.connection.query('insert into bmai_qa.platform_config(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()',[key,value]);}
  async bumpUsage(id:string,day:string,field:UsageField,max:number){
    if(!['saves','sessions','chats','searches'].includes(field)||!Number.isSafeInteger(max)||max<1)throw new Error('Invalid quota');
    const r=await this.connection.query(`insert into bmai_qa.usage(account_id,day,${field}) values($1,$2,1) on conflict(account_id,day) do update set ${field}=bmai_qa.usage.${field}+1 where bmai_qa.usage.${field}<$3 returning ${field} as count`,[id,day,max]);
    if(r[0])return {allowed:true,count:Number(r[0].count)};
    const current=await this.connection.query(`select ${field} as count from bmai_qa.usage where account_id=$1 and day=$2`,[id,day]);return {allowed:false,count:Number(current[0]?.count??max)};
  }
  async reserveAnalyticsBudget(hash:string,month:string,count:number,limit:number){
    if(!/^[a-f0-9]{64}$/.test(hash)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(limit)||limit<count||limit>900000)return false;
    const r=await this.connection.query('insert into bmai_qa.analytics_budgets(project_hash,month,count) values($1,$2,$3) on conflict(project_hash,month) do update set count=bmai_qa.analytics_budgets.count+excluded.count where bmai_qa.analytics_budgets.count<=$4 returning count',[hash,month,count,limit-count]);return r.length===1;
  }
  private release(r:Row):AppReleaseRow{return {platform:String(r.platform),version:String(r.version),build:r.build??null,minSupportedVersion:r.min_supported_version??null,downloadUrl:String(r.download_url),releaseNotes:r.release_notes??null,publishedAt:iso(r.published_at),updatedAt:iso(r.updated_at)};}
  async listAppReleases(){return (await this.connection.query('select * from bmai_qa.app_releases order by platform')).map(r=>this.release(r));}
  async getAppRelease(platform:string){const r=await this.connection.query('select * from bmai_qa.app_releases where platform=$1',[platform]);return r[0]?this.release(r[0]):null;}
  async upsertAppRelease(r:AppReleaseRow){await this.connection.query('insert into bmai_qa.app_releases(platform,version,build,min_supported_version,download_url,release_notes,published_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(platform) do update set version=excluded.version,build=excluded.build,min_supported_version=excluded.min_supported_version,download_url=excluded.download_url,release_notes=excluded.release_notes,published_at=excluded.published_at,updated_at=excluded.updated_at',[r.platform,r.version,r.build,r.minSupportedVersion,r.downloadUrl,r.releaseNotes,r.publishedAt,r.updatedAt]);}
  async deleteAppRelease(platform:string){return (await this.connection.query('delete from bmai_qa.app_releases where platform=$1 returning platform',[platform])).length>0;}
  private flow(r:Row):MacAuthFlow{return {flowId:r.flow_id,codeChallenge:r.code_challenge,verificationCode:r.verification_code,csrfHash:r.csrf_hash,csrfUserId:r.csrf_user_id,csrfSessionId:r.csrf_session_id,clerkUserId:r.clerk_user_id,state:r.state,createdAt:Number(r.created_at),expiresAt:Number(r.expires_at),consumedAt:r.consumed_at==null?null:Number(r.consumed_at)};}
  async createMacAuthFlow(i:CreateMacAuthFlow){await this.connection.query('insert into bmai_qa.macos_auth_flows(flow_id,code_challenge,verification_code,created_at,expires_at) values($1,$2,$3,$4,$5)',[i.flowId,i.codeChallenge,i.verificationCode,i.createdAt,i.expiresAt]);}
  async getMacAuthFlow(id:string){const r=await this.connection.query('select * from bmai_qa.macos_auth_flows where flow_id=$1',[id]);return r[0]?this.flow(r[0]):null;}
  async issueMacAuthCsrf(id:string,hash:string,user:string,session:string,now:number){return (await this.connection.query("update bmai_qa.macos_auth_flows set csrf_hash=$2,csrf_user_id=$3,csrf_session_id=$4 where flow_id=$1 and state='pending' and expires_at>$5 returning flow_id",[id,hash,user,session,now])).length===1;}
  async authorizeMacAuthFlow(i:Parameters<MasterRepository['authorizeMacAuthFlow']>[0]):ReturnType<MasterRepository['authorizeMacAuthFlow']>{
    const f=await this.getMacAuthFlow(i.flowId);if(!f||f.csrfHash!==i.csrfHash)return 'invalid';if(f.csrfUserId!==i.clerkUserId||f.csrfSessionId!==i.clerkSessionId)return 'auth-changed';if(f.expiresAt<=i.now)return 'expired';if(f.state!=='pending')return 'not-pending';
    const r=await this.connection.query("update bmai_qa.macos_auth_flows set state=$2,clerk_user_id=$3,csrf_hash=null,csrf_user_id=null,csrf_session_id=null where flow_id=$1 and state='pending' and expires_at>$4 and csrf_hash=$5 and csrf_user_id=$6 and csrf_session_id=$7 returning flow_id",[i.flowId,i.action==='approve'?'approved':'canceled',i.action==='approve'?i.clerkUserId:null,i.now,i.csrfHash,i.clerkUserId,i.clerkSessionId]);return r.length?(i.action==='approve'?'approved':'canceled'):'not-pending';
  }
  async consumeMacAuthFlow(i:Parameters<MasterRepository['consumeMacAuthFlow']>[0]):ReturnType<MasterRepository['consumeMacAuthFlow']>{
    const f=await this.getMacAuthFlow(i.flowId);if(!f||f.codeChallenge!==i.codeChallenge)return {status:'invalid'};if(f.expiresAt<=i.now)return {status:'expired'};if(f.state==='consumed')return {status:'replayed'};if(f.state==='pending'||f.state==='canceled')return {status:f.state};
    const r=await this.connection.query("update bmai_qa.macos_auth_flows set state='consumed',consumed_at=$2 where flow_id=$1 and state='approved' and expires_at>$2 and code_challenge=$3 returning clerk_user_id",[i.flowId,i.now,i.codeChallenge]);return r[0]?.clerk_user_id?{status:'ready',clerkUserId:String(r[0].clerk_user_id)}:{status:'replayed'};
  }
  async purgeMacAuthFlows(now:number,retention=86400000){return (await this.connection.query('delete from bmai_qa.macos_auth_flows where expires_at<$1 returning flow_id',[now-retention])).length;}
  async manageSessions(user:string,current:string,operation:string,target:string|null=null,metadata:Record<string,unknown>={}) {
    // A provider refresh transaction need not share our owner advisory lock.
    // PostgreSQL rolls the entire failed statement back before this retry.
    for(let attempt=0;attempt<3;attempt++){
      try{
        const rows=await this.connection.query('select bmai_qa.manage_sessions($1,$2,$3,$4,$5::jsonb) as result',[user,current,operation,target,metadata]);
        return rows[0]?.result;
      }catch(error){
        if(!['40P01','40001'].includes(String((error as any)?.code))||attempt===2)throw error;
        await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)+Math.floor(Math.random()*20)));
      }
    }
  }
}
export class AccountDisabledError extends Error {}
export function assertQaTenantName(name:string):void {if(!/^bmai-sbqa-[a-f0-9]{24,64}$/.test(name))throw new Error('Refusing database outside isolated Supabase QA namespace');}

/** Stable across Next route bundles/HMR; never use constructor identity for the global master cache. */
export function isPostgresMasterRepository(value: unknown): value is PostgresMasterRepository {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'postgres') return false;
  const connection = candidate.connection as Partial<PgExecutor> | undefined;
  if (!connection || typeof connection.query !== 'function' || typeof connection.transaction !== 'function') return false;
  return ['ready','resolveAccount','lookupAccount','manageSessions','getTenant','insertTenant','deleteTenant','listActiveTenants','getPlatformConfig','setPlatformConfig','bumpUsage','reserveAnalyticsBudget','listAppReleases','getAppRelease','upsertAppRelease','deleteAppRelease','createMacAuthFlow','getMacAuthFlow','issueMacAuthCsrf','authorizeMacAuthFlow','consumeMacAuthFlow','purgeMacAuthFlows'].every(method => typeof candidate[method] === 'function');
}
