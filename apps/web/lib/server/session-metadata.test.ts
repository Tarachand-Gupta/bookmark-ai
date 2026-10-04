import { describe,it,expect } from 'vitest';
import { sessionMetadataSchema,sessionRenameSchema } from './session-management';
import { authMutationOriginAllowed } from './auth-request-origin';
describe('display metadata boundary',()=>{
  it('sanitizes labels and refuses bearer copies and unbounded labels',()=>{
    expect(sessionMetadataSchema.parse({clientType:'ios',deviceName:'<b>Phone</b>\u0000\u202e'}).deviceName).toBe('Phone');
    expect(sessionMetadataSchema.safeParse({clientType:'ios',accessToken:'secret'}).success).toBe(false);
    expect(sessionMetadataSchema.safeParse({clientType:'admin'}).success).toBe(false);
    expect(sessionRenameSchema.safeParse({displayName:'a'.repeat(81)}).success).toBe(false);
    expect(sessionRenameSchema.safeParse({displayName:'\u0000'}).success).toBe(false);
  });
  it('requires exact origin for cookie mutations and supports bearer native clients',()=>{
    const request=(headers:Record<string,string>)=>new Request('https://qa.example.invalid/api/auth/sessions/current',{method:'POST',headers});
    expect(authMutationOriginAllowed(request({origin:'https://evil.example.invalid'}))).toBe(false);
    expect(authMutationOriginAllowed(request({}))).toBe(false);
    expect(authMutationOriginAllowed(request({origin:'https://qa.example.invalid','sec-fetch-site':'same-origin'}))).toBe(true);
    expect(authMutationOriginAllowed(request({authorization:'Bearer not-real'}))).toBe(true);
  });
});
