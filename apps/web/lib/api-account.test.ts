import { afterEach, describe, expect, it, vi } from "vitest";
const auth=vi.hoisted(()=>({getAccessToken:vi.fn(),getSession:vi.fn()}));
vi.mock("./auth",()=>({getAccessToken:auth.getAccessToken,getBrowserSupabase:()=>({auth:{getSession:auth.getSession}})}));
import { apiHeadersForAccount, applyOrganizationOperation } from "./api";
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe("account-bound async API headers",()=>{
  it("does not send an old account's mutation with credentials resolved after an account switch",async()=>{
    let release!: (token:string)=>void;auth.getAccessToken.mockImplementation(()=>new Promise(r=>{release=r;}));auth.getSession.mockResolvedValue({data:{session:{user:{id:"new-account"}}}});const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const request=applyOrganizationOperation({operationId:"operation-id",action:"bookmarks.update",bookmarkIds:["private-id"],changes:{folderId:null}},"original-account");release("new-account-test-token");await expect(request).rejects.toThrow("account changed");expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a mismatched token even when the later session belongs to the requested account",async()=>{
    auth.getAccessToken.mockResolvedValue("account-a-token");auth.getSession.mockResolvedValue({data:{session:{user:{id:"account-b"},access_token:"account-b-token"}}});await expect(apiHeadersForAccount("account-b")).rejects.toThrow("account changed");
  });
  it("allows refreshed credentials for the original account",async()=>{
    auth.getAccessToken.mockResolvedValue("refreshed-test-token");auth.getSession.mockResolvedValue({data:{session:{user:{id:"account"},access_token:"refreshed-test-token"}}});expect(await apiHeadersForAccount("account")).toEqual({authorization:"Bearer refreshed-test-token","X-Bookmark-Client":"web"});
  });
});
