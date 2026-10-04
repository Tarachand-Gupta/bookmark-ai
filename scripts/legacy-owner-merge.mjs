/** Pure exact-record merge contract; transport and approval belong to the driver. */
import {canonical,digest} from './legacy-master-import.mjs';
export const MERGE_TABLES=['chat_conversations','chat_messages','user_settings','ai_usage'];
const keyColumn={chat_conversations:'id',chat_messages:'id',user_settings:'user_id',ai_usage:'week_start'};
const fail=message=>{throw new Error(message);};
export function buildOwnerMerge(existing,incoming,{accountId,columns}){
 const actions=[];
 for(const table of MERGE_TABLES){
  const keys=new Set();for(const raw of incoming[table]??[]){const row=canonical(raw);const key=keyColumn[table];if(typeof row[key]!=='string'||!row[key]||keys.has(row[key]))fail('Invalid duplicate merge record');keys.add(row[key]);
   if(Object.keys(row).some(k=>!columns[table]?.includes(k)))fail('Target tenant schema differs; review required');
   if(table==='user_settings'&&row.user_id!==accountId)fail('Settings row does not belong to canonical account');
   const matches=(existing[table]??[]).filter(r=>r[key]===row[key]);if(matches.length>1)fail('Ambiguous target record');const before=matches[0]?canonical(matches[0]):null;let after=row;
   if(table==='ai_usage'){
    const old=Number(before?.tokens??0),added=Number(row.tokens);if(!Number.isSafeInteger(old)||old<0||!Number.isSafeInteger(added)||added<0||!Number.isSafeInteger(old+added))fail('Invalid AI credit counter');after={...(before??row),tokens:old+added};
   }else if(before&&digest(before)!==digest(row))fail('User record ID collision; merge refused');
   actions.push({table,keyColumn:key,key:row[key],before,after});
  }
 }
 const parents=new Set([...(existing.chat_conversations??[]),...(incoming.chat_conversations??[])].map(r=>r.id));
 if((incoming.chat_messages??[]).some(r=>!parents.has(r.conversation_id)))fail('Missing chat conversation');
 return canonical({version:1,accountId,actions});
}
export function mergeState(plan,rows){
 const states=plan.actions.map(a=>{const matches=(rows[a.table]??[]).filter(r=>r[a.keyColumn]===a.key);if(matches.length>1)fail('Ambiguous merge state');const current=matches[0]??null;if(digest(current)===digest(a.after))return'after';if(digest(current)===digest(a.before))return'before';return'conflict';});
 if(states.includes('conflict'))return'conflict';
 const changed=plan.actions.map((a,i)=>digest(a.before)===digest(a.after)?null:states[i]).filter(Boolean);
 if(changed.every(s=>s==='after'))return'after';if(changed.every(s=>s==='before'))return'before';return'conflict';
}
