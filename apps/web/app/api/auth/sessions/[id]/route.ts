import { sessionAction } from '@/lib/server/session-management';
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,context:Context){return sessionAction(request,'rename',(await context.params).id);}
export async function DELETE(request:Request,context:Context){return sessionAction(request,'revoke',(await context.params).id);}
