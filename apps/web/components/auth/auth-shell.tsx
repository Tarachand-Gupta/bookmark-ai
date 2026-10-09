import type { ReactNode } from "react";
import Link from "next/link";
import { display } from "@/components/marketing/primitives";
import { marketingFontVars } from "@/components/marketing/fonts";
import { BookmarkMark, Wordmark } from "@/components/marketing/primitives";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { FieldDescription } from "@/components/ui/field";
import { ThemePicker } from "@/components/theme-picker";
import { Loader2 } from "lucide-react";

export function AuthShell({
  title,
  description,
  children,
  signingIn = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  signingIn?: boolean;
}) {
  return (
    <div className={`${marketingFontVars} flex min-h-dvh flex-col bg-muted`}>
      <div className="absolute right-4 top-4"><ThemePicker /></div>
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
        {/* Adapted from upstream shadcn login-03: muted surface, centered brand,
            CardHeader/CardContent and Field controls. */}
        <div className="flex w-full max-w-sm flex-col gap-6">
          <Link href="/?view=website" className="flex items-center gap-2 self-center font-medium" aria-label="Bookmark AI home">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"><BookmarkMark className="size-4" /></span>
            <Wordmark className="text-sm" />
          </Link>
          <Card aria-labelledby="auth-title" role={signingIn ? "status" : undefined} aria-live={signingIn ? "polite" : undefined} aria-busy={signingIn}>
            <CardHeader className="text-center">
              <h1 id="auth-title" className={`${display} text-xl font-semibold tracking-[-0.02em]`}>{signingIn ? "Signing you in…" : title}</h1>
              <CardDescription>{signingIn ? "Checking your sign-in details…" : description}</CardDescription>
            </CardHeader>
            <CardContent>{signingIn ? <Loader2 className="mx-auto size-6 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden /> : <div className="flex flex-col gap-6">{children}</div>}</CardContent>
          </Card>
          {!signingIn && <FieldDescription className="flex flex-wrap items-center justify-center gap-x-2 text-center text-xs leading-relaxed text-muted-foreground">
            <Link
              href="/terms"
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Terms of service
            </Link>
            <span aria-hidden>·</span>
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Privacy policy
            </Link>
            <span aria-hidden>·</span>
            <Link
              href="/support"
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Help
            </Link>
          </FieldDescription>}
        </div>
      </main>
    </div>
  );
}
