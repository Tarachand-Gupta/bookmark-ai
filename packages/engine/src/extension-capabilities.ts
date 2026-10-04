/** Signed provider client_id plus an operator-owned allowlist defines authority. */
export function classifyOAuthClient(clientId:unknown,allowedIds:readonly string[]):'human'|'extension'|'denied'{
  if(clientId===undefined||clientId===null)return 'human';
  return typeof clientId==='string'&&allowedIds.includes(clientId)?'extension':'denied';
}
const routes=new Set(['POST /api/bookmarks','POST /api/sessions','GET /api/me','GET /api/settings','GET /api/live-token','POST /api/auth/sessions/current','POST /api/auth/sessions/sign-out']);
export function extensionRouteAllowed(stamp:string|null):boolean{
  if(!stamp)return false;
  const [method,path,extra]=stamp.split(' ');if(!method||!path||extra)return false;
  const route=`${method.toUpperCase()} ${path.replace(/\/+$/,'')}`;
  return routes.has(route)||/^DELETE \/api\/bookmarks\/[A-Za-z0-9_-]+$/.test(route);
}
