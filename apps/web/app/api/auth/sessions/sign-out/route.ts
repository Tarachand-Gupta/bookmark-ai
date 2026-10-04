import { sessionAction } from '@/lib/server/session-management';
export async function POST(request:Request){return sessionAction(request,'sign-out');}
