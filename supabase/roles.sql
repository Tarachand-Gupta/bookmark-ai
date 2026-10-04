-- Cluster role bootstrap, applied before schema migrations. No login credentials here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bmai_qa_backend') THEN
    CREATE ROLE bmai_qa_backend NOLOGIN;
  END IF;
END $$;
