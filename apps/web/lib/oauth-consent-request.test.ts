import {describe,it,expect,vi} from 'vitest';
import {createConsentRequest} from './oauth-consent-request';
describe('consuming OAuth authorization request',()=>{
 it('shares autoapproval redirect with a replacement effect instead of consuming it twice',async()=>{
  const load=vi.fn().mockResolvedValueOnce({data:{redirect_url:'https://qa.chromiumapp.org/callback?code=disposable'},error:null}).mockResolvedValue({data:null,error:{status:400}});
  const request=createConsentRequest<{data:{redirect_url:string}|null;error:{status:number}|null}>(load);
  const canceledEffect=request('authorization','owner');
  const replacementEffect=request('authorization','owner');
  expect(replacementEffect).toBe(canceledEffect);
  expect((await replacementEffect).data?.redirect_url).toContain('callback');
  expect(load).toHaveBeenCalledOnce();
 });
 it('never shares another account or a new authorization request',async()=>{
  const load=vi.fn(async(id:string)=>({id}));const request=createConsentRequest(load);
  await request('one','owner');await request('one','foreign');await request('two','foreign');expect(load).toHaveBeenCalledTimes(3);
 });
});
