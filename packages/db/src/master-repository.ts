import type { Db } from './client';
import type { Tenant, UsageField } from './master';
import type { AppReleaseRow } from './queries/app-releases';
import type { MacAuthFlow, CreateMacAuthFlow, AuthorizeMacAuthFlowResult, ConsumeMacAuthFlowResult } from './queries/macos-auth';

/** Control-plane operations. PostgreSQL is deliberately not presented as libSQL. */
export interface MasterRepository {
  readonly kind: 'postgres';
  getTenant(accountId: string): Promise<Tenant | null>;
  insertTenant(tenant: Tenant): Promise<Tenant>;
  deleteTenant(accountId: string): Promise<boolean>;
  listActiveTenants(): Promise<Tenant[]>;
  getPlatformConfig(key: string): Promise<string | null>;
  setPlatformConfig(key: string, value: string): Promise<void>;
  bumpUsage(accountId: string, day: string, field: UsageField, max: number): Promise<{allowed: boolean; count: number}>;
  reserveAnalyticsBudget(hash: string, month: string, count: number, limit: number): Promise<boolean>;
  listAppReleases(): Promise<AppReleaseRow[]>;
  getAppRelease(platform: string): Promise<AppReleaseRow | null>;
  upsertAppRelease(release: AppReleaseRow): Promise<void>;
  deleteAppRelease(platform: string): Promise<boolean>;
  createMacAuthFlow(input: CreateMacAuthFlow): Promise<void>;
  getMacAuthFlow(id: string): Promise<MacAuthFlow | null>;
  issueMacAuthCsrf(id: string, hash: string, user: string, session: string, now: number): Promise<boolean>;
  authorizeMacAuthFlow(input: {flowId:string;csrfHash:string;clerkUserId:string;clerkSessionId:string;action:'approve'|'cancel';now:number}): Promise<AuthorizeMacAuthFlowResult>;
  consumeMacAuthFlow(input: {flowId:string;codeChallenge:string;now:number}): Promise<ConsumeMacAuthFlowResult>;
  purgeMacAuthFlows(now: number, retention?: number): Promise<number>;
}
export type MasterStore = Db | MasterRepository;
export function isMasterRepository(store: MasterStore): store is MasterRepository {
  return 'kind' in store && store.kind === 'postgres';
}
