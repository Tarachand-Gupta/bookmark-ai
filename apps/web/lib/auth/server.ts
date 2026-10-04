import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function getCookieAccessToken(): Promise<string | null> {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const client = createServerClient(url, key, {
    cookieOptions: { name: "bmai-supabase-qa-auth" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* middleware owns refreshed response cookies */
        }
      },
    },
  });
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error("Authentication cookies could not be read.");
  return data.session?.access_token ?? null;
}
