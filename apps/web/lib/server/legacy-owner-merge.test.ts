import {describe,it,expect} from 'vitest';
import {buildOwnerMerge,mergeState} from '../../../../scripts/legacy-owner-merge.mjs';
const account='326e3333-e592-4e7e-bb37-781944b394dd';
const columns={chat_conversations:['id','title'],chat_messages:['id','conversation_id','parts_json'],user_settings:['user_id','ai_mode'],ai_usage:['week_start','tokens']};
const old={chat_conversations:[{id:'old',title:'retained'}],chat_messages:[],user_settings:[{user_id:'user_legacy',ai_mode:'own'}],ai_usage:[{week_start:'2026-09-28',tokens:80}]};
const incoming={chat_conversations:[{id:'new',title:'current'}],chat_messages:[{id:'m1',conversation_id:'new',parts_json:'[]'}],user_settings:[{user_id:account,ai_mode:'included'}],ai_usage:[{week_start:'2026-09-28',tokens:10}]};
describe('owned displaced-content merge contract',()=>{
 it('preserves both settings rows, chat dependencies and adds exact credits once',()=>{
  const plan=buildOwnerMerge(old,incoming,{accountId:account,columns});expect(plan.actions).toHaveLength(4);expect(plan.actions[3].after.tokens).toBe(90);expect(plan.actions[2].before).toBe(null);expect(mergeState(plan,old)).toBe('before');
  const after:Record<string,Record<string,unknown>[]>=structuredClone(old);for(const a of plan.actions)after[a.table]=[...after[a.table].filter(r=>r[a.keyColumn]!==a.key),a.after];expect(mergeState(plan,after)).toBe('after');expect(after.user_settings).toHaveLength(2);expect(after.chat_conversations).toHaveLength(2);
  expect(mergeState(plan,{...after,ai_usage:[{week_start:'2026-09-28',tokens:91}]})).toBe('conflict');
 });
 it('refuses conflicting existing IDs, foreign settings, missing parent and invalid credits',()=>{
  expect(()=>buildOwnerMerge({...old,chat_conversations:[{id:'new',title:'different'}]},incoming,{accountId:account,columns})).toThrow('collision');
  expect(()=>buildOwnerMerge(old,{...incoming,user_settings:[{user_id:'foreign',ai_mode:'own'}]},{accountId:account,columns})).toThrow('canonical');
  expect(()=>buildOwnerMerge(old,{...incoming,chat_messages:[{id:'m1',conversation_id:'absent',parts_json:'[]'}]},{accountId:account,columns})).toThrow('conversation');
  expect(()=>buildOwnerMerge(old,{...incoming,ai_usage:[{week_start:'2026-09-28',tokens:-1}]},{accountId:account,columns})).toThrow('counter');
 });
 it('recognizes atomic commit after crash and rejects partial or later writes',()=>{
  const plan=buildOwnerMerge(old,incoming,{accountId:account,columns});const partial={...old,chat_conversations:[...old.chat_conversations,...incoming.chat_conversations]};expect(mergeState(plan,partial)).toBe('conflict');
  expect(()=>buildOwnerMerge(old,{...incoming,user_settings:[{user_id:account,ai_mode:'included',unknown:'x'}]},{accountId:account,columns})).toThrow('schema');
 });
});
