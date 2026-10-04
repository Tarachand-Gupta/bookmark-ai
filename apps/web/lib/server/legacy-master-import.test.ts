import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { CredentialCipher, PostgresMasterRepository, bindTenantSettingsOwner, createDb, ensureSchema, getUserSettings, upsertUserSettings, getLiveSettings, setLiveSettings, type PgExecutor } from '@bookmark-ai/db';
import { beginQaAccountDeletion, provisionQaTenant } from '@bookmark-ai/engine';
const account='b3b81aee-bc2d-4eb4-a6d7-bb58af2c4ead', other='77e50618-aaeb-4b93-98cc-3ab468be9f55', subject='c108d2f8-a560-4144-8b73-7a1c409de509';
let pg:PGlite,master:PostgresMasterRepository;
const cipher=new CredentialCipher(Buffer.alloc(32,8).toString('base64'));
const wrap=(db:any):PgExecutor=>({query:async(sql,args=[])=> (await db.query(sql,args)).rows,transaction:work=>db.transaction((tx:any)=>work(wrap(tx)))});
beforeAll(async()=>{
 pg=new PGlite();await pg.exec('create role anon;create role authenticated;create role bmai_qa_backend;create schema auth;create table auth.users(id uuid primary key);');
 // Core declarative schema also references auth.sessions; the actual control-plane
 // migration creates that provider fixture separately in postgres-master.test.
 await pg.exec('create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));');
 const core=await readFile(new URL('../../../../supabase/schemas/bmai_qa.sql',import.meta.url),'utf8');
 await pg.exec(core);
 await pg.exec(await readFile(new URL('../../../../supabase/schemas/legacy_imports.sql',import.meta.url),'utf8'));
 await pg.query('insert into auth.users(id) values($1)',[subject]);
 await pg.query('insert into bmai_qa.accounts(id) values($1),($2)',[account,other]);
 await pg.query("insert into bmai_qa.identities values('supabase',$1,$2)",[subject,account]);
 await pg.query("insert into bmai_qa.tenant_operations(account_id,kind,db_name,stage,owned) values($1,'provision',$2,'complete',true)",[account,'bmai-sbqa-'+ 'a'.repeat(32)]);
 await pg.transaction(async tx=>{
  await tx.query("insert into bmai_qa.legacy_imports(account_id,clerk_subject,db_name,db_url,source_digest,identity_evidence) values($1,'user_legacyOwner','bmk-import-fixture','libsql://bmk-import-fixture-team.turso.io',$2,'provider-subject')",[account,'1'.repeat(64)]);
  await tx.query("insert into bmai_qa.tenants(account_id,db_name,db_url,credential_ciphertext) values($1,'bmk-import-fixture','libsql://bmk-import-fixture-team.turso.io',$2)",[account,cipher.encrypt('fixture-token',account)]);
 });
 master=new PostgresMasterRepository(wrap(pg),cipher);
},30000);
afterAll(async()=>{await pg?.close();});
describe('exact imported tenant provenance',()=>{
 it('admits only exact recorded account/name/url and encrypted credential owner',async()=>{
  expect(await master.getTenant(account)).toMatchObject({legacyOwnerId:'user_legacyOwner',dbAuthToken:'fixture-token'});
  expect(await master.getTenant(other)).toBe(null);
  expect((await master.listActiveTenants())[0].legacyOwnerId).toBe('user_legacyOwner');
  await expect(pg.query("update bmai_qa.tenants set db_url='libsql://other-team.turso.io' where account_id=$1",[account])).rejects.toThrow('provenance');
  await expect(pg.query("update bmai_qa.tenants set db_name=$2 where account_id=$1",[account,'bmai-sbqa-'+'b'.repeat(32)])).rejects.toThrow('provenance');
  await expect(pg.query('update bmai_qa.tenants set account_id=$2 where account_id=$1',[account,other])).rejects.toThrow();
 });
 it('cannot remove or rewrite ownership while a legacy route remains',async()=>{
  await expect(pg.query('delete from bmai_qa.legacy_imports where account_id=$1',[account])).rejects.toThrow('provenance');
  await expect(pg.query("update bmai_qa.legacy_imports set clerk_subject='user_foreign' where account_id=$1",[account])).rejects.toThrow('immutable');
 });
 it('keeps imported libraries out of automatic provision/delete without changing account state',async()=>{
  const platform={createDatabase:vi.fn(),createToken:vi.fn(),getDatabase:vi.fn(),deleteDatabase:vi.fn()};
  expect((await provisionQaTenant(master,platform,account)).legacyOwnerId).toBe('user_legacyOwner');
  expect(platform.createDatabase).not.toHaveBeenCalled();
  await expect(pg.query("update bmai_qa.tenant_operations set stage='pending' where account_id=$1",[account])).rejects.toThrow('automatic');
  await expect(beginQaAccountDeletion(master,account,subject)).rejects.toThrow('ownership review');
  expect((await pg.query<any>('select state from bmai_qa.accounts where id=$1',[account])).rows[0].state).toBe('active');
  expect((await master.getTenant(account))?.status).toBe('active');
 });
 it('denies public/authenticated read of import provenance',async()=>{
  await pg.exec('set role authenticated');try{await expect(pg.query('select * from bmai_qa.legacy_imports')).rejects.toThrow();}finally{await pg.exec('reset role');}
 });
 it('can restore QA before-image atomically but never leave an unproven route',async()=>{
  await pg.transaction(async tx=>{
   await tx.query('delete from bmai_qa.legacy_imports where account_id=$1',[account]);
   await tx.query('update bmai_qa.tenants set db_name=$2,db_url=$3 where account_id=$1',[account,'bmai-sbqa-'+'a'.repeat(32),'file:/qa-fixture.db']);
  });
  expect((await master.getTenant(account))?.legacyOwnerId).toBeUndefined();
 });
});
describe('imported settings ownership',()=>{
 it('preserves old settings reads/writes and rejects another account; survives module reload',async()=>{
  const db=createDb('file::memory:');try{
   await ensureSchema(db);await upsertUserSettings(db,'user_legacyOwner',{aiModel:'existing',onboardedAt:'2026-01-01'});
   bindTenantSettingsOwner(db,account,'user_legacyOwner');
   expect(await getUserSettings(db,account)).toMatchObject({userId:account,aiModel:'existing'});
   await upsertUserSettings(db,account,{aiModel:'updated'});
   expect((await db.execute("select count(*) as n from user_settings")).rows[0].n).toBe(1);
   expect((await getUserSettings(db,account))?.onboardedAt).toBe('2026-01-01');
   await expect(getUserSettings(db,other)).rejects.toThrow('does not own');
   await expect(upsertUserSettings(db,other,{aiModel:'attack'})).rejects.toThrow('does not own');
   vi.resetModules();const fresh=await import('../../../../packages/db/src/tenant-settings-owner');
   expect(fresh.tenantSettingsOwner(db,account)).toBe('user_legacyOwner');
   expect(()=>fresh.bindTenantSettingsOwner(db,other,'user_foreign')).toThrow('Conflicting');
  }finally{db.close();}
 });
 it('preserves exact legacy live opt-in but never adopts unrelated local sentinel',async()=>{
  const db=createDb('file::memory:');try{
   await ensureSchema(db);await setLiveSettings(db,'local',true);
   bindTenantSettingsOwner(db,account,'user_legacyOwner');expect(await getLiveSettings(db,account)).toBe(false);
   await setLiveSettings(db,account,true);expect(await getLiveSettings(db,account)).toBe(true);
   await expect(getLiveSettings(db,other)).rejects.toThrow('does not own');
  }finally{db.close();}
 });
});
