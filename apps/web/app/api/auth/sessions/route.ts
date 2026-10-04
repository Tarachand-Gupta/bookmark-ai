import { sessionAction } from '@/lib/server/session-management';
export const dynamic='force-dynamic';
export async function GET(request:Request){return sessionAction(request,'list');}
