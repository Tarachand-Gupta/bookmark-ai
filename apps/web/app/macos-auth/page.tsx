import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { getWebAuth } from "@/lib/server/supabase-auth";
import { MacAuthStoreUnavailableError, macAuthFlowIdSchema, prepareMacAuthBrowser } from "@/lib/server/macos-auth";
import { MacAuthConfirmation } from "./MacAuthConfirmation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm Mac sign-in — Bookmark AI",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function MacAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string }>;
}) {
  noStore();
  const identity = await getWebAuth().catch(() => null);
  const userId = identity?.userId;
  const sessionId = identity?.sessionId;
  const parsedFlow = macAuthFlowIdSchema.safeParse((await searchParams).flow);
  if (!userId || !sessionId || !parsedFlow.success) return <Terminal title="Invalid sign-in request" />;

  let prepared;
  try {
    prepared = await prepareMacAuthBrowser(parsedFlow.data, userId, sessionId);
  } catch (error) {
    if (!(error instanceof MacAuthStoreUnavailableError)) console.error("[macos-auth/page] request failed");
    return <Terminal title="Sign-in service unavailable" detail="Return to the Mac app and try again shortly." />;
  }

  if (prepared.status !== "pending") {
    const content = {
      approved: ["Already confirmed", "Return to the Mac app to finish signing in."],
      canceled: ["Sign-in canceled", "Start a new request from the Mac app whenever you're ready."],
      consumed: ["Sign-in complete", "This request has already been used. You can close this tab."],
      expired: ["Sign-in request expired", "Return to the Mac app and start a new request."],
      invalid: ["Invalid sign-in request", "Return to the Mac app and start a new request."],
    }[prepared.status];
    return <Terminal title={content[0]} detail={content[1]} code={prepared.flow?.verificationCode} />;
  }

  const user = identity?.user;
  if (!user) return <Terminal title="Sign-in service unavailable" />;
  const primaryEmail = user.email ?? null;
  const accountLabel = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : primaryEmail || "Signed-in account";

  return (
    <PageShell>
      <MacAuthConfirmation
        flowId={prepared.flow.flowId}
        csrfToken={prepared.csrfToken}
        verificationCode={prepared.flow.verificationCode}
        accountLabel={accountLabel}
        accountEmail={primaryEmail && primaryEmail !== accountLabel ? primaryEmail : null}
      />
    </PageShell>
  );
}

function Terminal({ title, detail = "Return to the Mac app and start a new request.", code }: { title: string; detail?: string; code?: string }) {
  return (
    <PageShell>
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center text-card-foreground shadow-xl">
        <div className="text-sm font-medium text-muted-foreground">Bookmark AI for Mac</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        {code ? <div className="mt-5 font-mono text-xl font-semibold tracking-[0.14em]">{code}</div> : null}
        <p className="mt-4 text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12 text-foreground">{children}</main>;
}
