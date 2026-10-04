import { isPostgresMasterRepository } from '@bookmark-ai/db';
import { AuthUnavailableError, withAuthDeadline } from '@bookmark-ai/engine';
import { getMasterContext } from '../context';

/** MCP credentials outlive human sessions, but never a deleted account/tenant.
 * Do not lazy-provision from an integration token. Provider outages remain 503. */
export async function mcpAccountAccessible(subject: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subject)) return false;
  return withAuthDeadline(async () => {
    const master = getMasterContext();
    if (!master || !isPostgresMasterRepository(master.db)) throw new AuthUnavailableError('MCP control plane unavailable');
    await master.ready;
    const rows = await master.db.connection.query(
      "select a.id from bmai_qa.accounts a join bmai_qa.tenants t on t.account_id=a.id where a.id=$1 and a.state='active' and t.status='active' and exists(select 1 from bmai_qa.identities i where i.account_id=a.id and i.provider='supabase')",
      [subject],
    );
    return rows.length === 1;
  });
}
