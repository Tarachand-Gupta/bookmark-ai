-- Explicitly deny client roles even when hosted owner default privileges differ
-- from the generator's clean shadow baseline. Intentionally hand-authored.
revoke all on schema bmai_qa from public, anon, authenticated;
revoke all on all tables in schema bmai_qa from public, anon, authenticated;
revoke all on all sequences in schema bmai_qa from public, anon, authenticated;
revoke all on all functions in schema bmai_qa from public, anon, authenticated;
grant execute on function bmai_qa.manage_sessions(uuid,uuid,text,uuid,jsonb) to bmai_qa_backend;
