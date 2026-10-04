import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({master:vi.fn(),query:vi.fn()}));
vi.mock('../context',()=>({getMasterContext:state.master}));
import {CredentialCipher,PostgresMasterRepository} from '@bookmark-ai/db';
import {AuthUnavailableError} from '@bookmark-ai/engine';
import {mcpAccountAccessible} from './account-access';
const id='7b603a47-84aa-4142-b98d-493967160613';
beforeEach(()=>{
 state.query.mockReset().mockResolvedValue([{id}]);
 const repository=new PostgresMasterRepository({query:state.query,transaction:vi.fn()},new CredentialCipher(Buffer.alloc(32,3).toString('base64')));
 state.master.mockReset().mockReturnValue({db:repository,ready:Promise.resolve()});
});
afterEach(()=>vi.useRealTimers());
describe('MCP canonical account lifecycle gate',()=>{
 it('requires active canonical account and existing active tenant, without provisioning',async()=>{
  expect(await mcpAccountAccessible(id)).toBe(true);
  const [query,args]=state.query.mock.calls[0];expect(args).toEqual([id]);expect(query).toContain("a.state='active'");expect(query).toContain("t.status='active'");expect(query).toContain('join bmai_qa.tenants');expect(query).toContain("i.provider='supabase'");
 });
 it('denies deleted/missing account or removed tenant',async()=>{state.query.mockResolvedValue([]);expect(await mcpAccountAccessible(id)).toBe(false);});
 it('rejects noncanonical old subjects before SQL',async()=>{expect(await mcpAccountAccessible('user_legacy')).toBe(false);expect(state.query).not.toHaveBeenCalled();});
 it('keeps control-plane outages distinct from invalid credentials',async()=>{state.query.mockRejectedValue(new Error('database outage'));await expect(mcpAccountAccessible(id)).rejects.toThrow('database outage');});
 it('bounds a stalled control-plane lookup',async()=>{vi.useFakeTimers();state.query.mockImplementation(()=>new Promise(()=>{}));const pending=mcpAccountAccessible(id);const assertion=expect(pending).rejects.toBeInstanceOf(AuthUnavailableError);await vi.advanceTimersByTimeAsync(10000);await assertion;});
});
