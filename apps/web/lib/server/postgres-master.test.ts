import { describe,it,expect,beforeAll,afterAll,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { CredentialCipher, PostgresMasterRepository, isPostgresMasterRepository, type PgExecutor } from '@bookmark-ai/db';
import { beginQaAccountDeletion, deleteQaTenant, provisionQaTenant, qaTenantDbName } from '@bookmark-ai/engine';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilePlatform } from '@bookmark-ai/db';

const user='fcaa51f1-e2e9-4b90-8ea5-313b7b62b6aa',other='92a64893-f59d-482a-97b1-4d0d3f6c75e5';
const current='3023fbce-7f57-4b0f-aea7-a3c0842b6722',second='a93f70fb-ec35-4d18-bc71-69f13cf0727b',foreign='005bf2dd-36bf-4f93-8e81-06368c8f6c8b';
let pg:PGlite,master:PostgresMasterRepository,directory:string;
const wrap=(db:any):PgExecutor=>({query:async(sql,args=[])=> (await db.query(sql,args.map((value:any)=>value!==null&&typeof value==='object'&&!(value instanceof Date)?JSON.stringify(value):value))).rows,transaction:work=>db.transaction((tx:any)=>work(wrap(tx)))});
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz default now(),updated_at timestamptz default now(),refreshed_at timestamptz);
    create table auth.refresh_tokens(id uuid primary key,session_id uuid not null references auth.sessions(id) on delete cascade);`);
  await pg.exec(await readFile(new URL('../../../../supabase/roles.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../../../../supabase/migrations/20261004102129_bmai_qa_control_plane.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../../../../supabase/migrations/20261004102534_bmai_qa_security_hardening.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../../../../supabase/migrations/20261004191909_legacy_master_import_provenance.sql',import.meta.url),'utf8'));
  await pg.query('insert into auth.users(id) values($1),($2)',[user,other]);
  master=new PostgresMasterRepository(wrap(pg),new CredentialCipher(Buffer.alloc(32,3).toString('base64')));
  directory=await mkdtemp(join(tmpdir(),'bmai-sbqa-'));
},30000);
afterAll(async()=>{await pg?.close();if(directory)await rm(directory,{recursive:true,force:true});});
describe('PostgreSQL master semantics',()=>{
  it('accepts an independent module class copy but rejects libSQL and incomplete repositories',async()=>{
    vi.resetModules();
    const reloaded=await import('../../../../packages/db/src/postgres-master');
    expect(reloaded.PostgresMasterRepository).not.toBe(PostgresMasterRepository);
    const copy=new reloaded.PostgresMasterRepository(wrap(pg),new CredentialCipher(Buffer.alloc(32,3).toString('base64')));
    expect(copy instanceof PostgresMasterRepository).toBe(false);
    expect(isPostgresMasterRepository(copy)).toBe(true);
    expect(await copy.lookupAccount(user)).toBe(null);
    expect(isPostgresMasterRepository({kind:'libsql',connection:copy.connection})).toBe(false);
    expect(isPostgresMasterRepository({kind:'postgres',connection:copy.connection})).toBe(false);
    expect(isPostgresMasterRepository(null)).toBe(false);
  });
  it('maps verified provider subjects once, never links users by metadata/email',async()=>{
    const [a,b]=await Promise.all([master.resolveAccount(user),master.resolveAccount(user)]);
    expect(a).toBe(b);expect(await master.resolveAccount(other)).not.toBe(a);
    expect(await master.lookupAccount(user)).toBe(a);
  });
  it('caps concurrent daily quota and analytics reservations atomically',async()=>{
    const id=await master.resolveAccount(user);
    const results=await Promise.all(Array.from({length:30},()=>master.bumpUsage(id,'2026-10-04','saves',7)));
    expect(results.filter(r=>r.allowed)).toHaveLength(7);
    const reserve=await Promise.all(Array.from({length:20},()=>master.reserveAnalyticsBudget('a'.repeat(64),'2026-10',2,10)));
    expect(reserve.filter(Boolean)).toHaveLength(5);expect(await master.reserveAnalyticsBudget('bad','2026-10',1,10)).toBe(false);
    await expect(master.bumpUsage(id,'2026-10-04','saves;drop table' as any,7)).rejects.toThrow();
  });
  it('preserves config/release values and protects tenant ciphertext ownership',async()=>{
    await master.setPlatformConfig('limit','55');await master.setPlatformConfig('limit','65');expect(await master.getPlatformConfig('limit')).toBe('65');
    const release={platform:'macos',version:'1.2.3',build:null,minSupportedVersion:null,downloadUrl:'https://example.invalid/qa.zip',releaseNotes:null,publishedAt:'2026-10-04T00:00:00.000Z',updatedAt:'2026-10-04T00:00:00.000Z'};
    await master.upsertAppRelease(release);expect(await master.getAppRelease('macos')).toEqual(release);expect(await master.deleteAppRelease('macos')).toBe(true);
  });
  it('provisions isolated content idempotently and retries interrupted owned deletion',async()=>{
    const id=await master.resolveAccount(user),platform=new LocalFilePlatform(directory);
    const tenant=await provisionQaTenant(master,platform,id);expect(tenant.dbName).toBe(qaTenantDbName(id));expect(await provisionQaTenant(master,platform,id)).toEqual(tenant);
    const rows=await pg.query<any>('select credential_ciphertext from bmai_qa.tenants where account_id=$1',[id]);expect(rows.rows[0].credential_ciphertext).toMatch(/^v1\./);
    await beginQaAccountDeletion(master,id,user);await expect(master.resolveAccount(user)).rejects.toThrow();
    let failed=false;
    const unstable={...platform,createDatabase:platform.createDatabase.bind(platform),getDatabase:platform.getDatabase.bind(platform),createToken:platform.createToken.bind(platform),deleteDatabase:async(name:string)=>{if(!failed){failed=true;throw new Error('simulated remote outage');}await platform.deleteDatabase(name);}};
    await expect(deleteQaTenant(master,unstable,id)).rejects.toThrow('simulated remote outage');
    expect((await master.getTenant(id))?.status).toBe('deleting');await deleteQaTenant(master,unstable,id);expect(await master.getTenant(id)).toBe(null);
  });
  it('finishes owned receipts after a crash following tenant insert, without starving recovery',async()=>{
    const subject='e0086f62-cdb1-4a7e-8e48-84ba0c5f583c';
    await pg.query('insert into auth.users(id) values($1)',[subject]);
    const id=await master.resolveAccount(subject),platform=new LocalFilePlatform(directory);
    const original=master.insertTenant.bind(master);
    const insert=vi.spyOn(master,'insertTenant').mockImplementationOnce(async(input)=>{
      await original(input);throw new Error('crash after tenant insert');
    });
    await expect(provisionQaTenant(master,platform,id)).rejects.toThrow('crash after tenant insert');
    insert.mockRestore();
    expect((await master.getTenant(id))?.status).toBe('active');
    const create=vi.spyOn(platform,'createDatabase'),token=vi.spyOn(platform,'createToken');
    await provisionQaTenant(master,platform,id);
    expect(create).not.toHaveBeenCalled();expect(token).not.toHaveBeenCalled();
    expect((await pg.query<any>('select stage,owned,lease_id from bmai_qa.tenant_operations where account_id=$1',[id])).rows[0]).toMatchObject({stage:'complete',owned:true,lease_id:null});
    expect((await pg.query('select account_id from bmai_qa.tenant_operations where stage<>$1 and account_id=$2',['complete',id])).rows).toHaveLength(0);
    await pg.query("update bmai_qa.tenant_operations set owned=false,stage='migrated' where account_id=$1",[id]);
    await expect(provisionQaTenant(master,platform,id)).rejects.toThrow('exact recorded ownership');
    expect((await pg.query<any>('select stage,owned from bmai_qa.tenant_operations where account_id=$1',[id])).rows[0]).toMatchObject({stage:'migrated',owned:false});
    await pg.query("update bmai_qa.tenant_operations set owned=true,db_name=$2 where account_id=$1",[id,qaTenantDbName(subject)]);
    await expect(provisionQaTenant(master,platform,id)).rejects.toThrow('exact recorded ownership');
    create.mockRestore();token.mockRestore();
  });
  it('never adopts unowned existing database or enters production namespace',async()=>{
    const id=await master.resolveAccount(other);let migrated=false;
    const platform={createDatabase:async(name:string)=>({name,hostname:'production.example.invalid',created:false}),getDatabase:async(name:string)=>({name,hostname:'production.example.invalid',created:false}),createToken:async()=>{migrated=true;return 'secret';},deleteDatabase:async()=>{throw new Error('must not delete');}};
    await expect(provisionQaTenant(master,platform,id)).rejects.toThrow('Unconfirmed database ownership');expect(migrated).toBe(false);
    await expect(master.insertTenant({clerkUserId:id,dbName:'bmk-production',dbUrl:'libsql://prod',dbAuthToken:'not-real',status:'active',plan:'free',createdAt:new Date().toISOString()})).rejects.toThrow('isolated');
  });
});
describe('native session SQL adapter',()=>{
  beforeAll(async()=>{
    await pg.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$2),($4,$5)',[current,user,second,foreign,other]);
    await pg.query('insert into auth.refresh_tokens(id,session_id) values($1,$2)',[second,second]);
  });
  it('passes JSONB metadata as an object for postgres.js inferred serialization',async()=>{
    const query=vi.fn().mockImplementation(async(_sql,args)=>{
      // postgres.js JSONB serializer performs JSON.stringify itself. A caller
      // string would become a JSON scalar and lose clientType/displayName.
      const wire=JSON.stringify(args[4]);
      const parsed=JSON.parse(wire);
      expect(parsed).toEqual({clientType:'web',displayName:'QA browser'});
      expect(typeof parsed).toBe('object');
      return [{result:parsed}];
    });
    const repo=new PostgresMasterRepository({query,transaction:async()=>{throw new Error('unused');}},new CredentialCipher(Buffer.alloc(32,3).toString('base64')));
    expect(await repo.manageSessions(user,current,'register',null,{clientType:'web',displayName:'QA browser'})).toEqual({clientType:'web',displayName:'QA browser'});
  });
  it('lists only own native sessions and stores no authorization token',async()=>{
    const list=await master.manageSessions(user,current,'list');expect(list.map((s:any)=>s.id).sort()).toEqual([current,second].sort());
    await master.manageSessions(user,current,'register',null,{displayName:'QA laptop',clientType:'macos'});
    expect((await master.manageSessions(user,current,'list')).find((s:any)=>s.isCurrent).displayName).toBe('QA laptop');
    expect(await master.manageSessions(user,current,'rename',foreign,{displayName:'Attack'})).toBe(null);expect(await master.manageSessions(user,current,'revoke',foreign)).toBe(false);
  });
  it('revokes selected native session and cascades refresh plus label cleanup',async()=>{
    await master.manageSessions(user,second,'register',null,{displayName:'QA phone',clientType:'ios'});
    expect(await master.manageSessions(user,current,'revoke',second)).toBe(true);
    expect((await pg.query('select * from auth.refresh_tokens where session_id=$1',[second])).rows).toHaveLength(0);
    expect((await pg.query('select * from bmai_qa.session_labels where session_id=$1',[second])).rows).toHaveLength(0);
    await expect(master.manageSessions(user,second,'list')).rejects.toThrow('session_not_found');
    expect((await master.manageSessions(user,current,'list')).map((s:any)=>s.id)).toEqual([current]);
  });
  it('denies foreign caller/session pairing and public-role access',async()=>{
    await expect(master.manageSessions(other,current,'global')).rejects.toThrow('session_not_found');
    await pg.exec('set role authenticated');
    try{await expect(pg.query('select * from bmai_qa.tenants')).rejects.toThrow();await expect(pg.query("select bmai_qa.manage_sessions($1,$2,'global')",[user,current])).rejects.toThrow();}finally{await pg.exec('reset role');}
  });
  it('serializes reciprocal revoke; a losing revoked caller cannot act',async()=>{
    const a='3c6d4f2d-b6c7-49e0-9668-374cded42b68',b='6bda93db-2116-492a-b1a4-f8b0f4b77d32';
    await pg.query('insert into auth.sessions(id,user_id) values($1,$3),($2,$3)',[a,b,other]);
    const results=await Promise.allSettled([master.manageSessions(other,a,'revoke',b),master.manageSessions(other,b,'revoke',a)]);
    expect(results.filter(r=>r.status==='fulfilled'&&r.value===true)).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect((await pg.query('select id from auth.sessions where id in ($1,$2)',[a,b])).rows).toHaveLength(1);
  });
  it('retries only rolled-back deadlock/serialization failures, with bounded attempts',async()=>{
    const query=vi.fn().mockRejectedValueOnce({code:'40P01'}).mockResolvedValueOnce([{result:true}]);
    const repo=new PostgresMasterRepository({query,transaction:async()=>{throw new Error('unused');}},new CredentialCipher(Buffer.alloc(32,3).toString('base64')));
    expect(await repo.manageSessions(user,current,'revoke',second)).toBe(true);expect(query).toHaveBeenCalledTimes(2);
    query.mockReset().mockRejectedValue({code:'40001'});await expect(repo.manageSessions(user,current,'list')).rejects.toEqual({code:'40001'});expect(query).toHaveBeenCalledTimes(3);
    query.mockReset().mockRejectedValue({code:'28000'});await expect(repo.manageSessions(user,current,'list')).rejects.toEqual({code:'28000'});expect(query).toHaveBeenCalledOnce();
  });
});
