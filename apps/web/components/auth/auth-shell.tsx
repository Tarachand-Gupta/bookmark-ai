/* Hallmark · scoped auth redesign · existing shadcn neutral system
 * Pre-emit critique: Philosophy 4 · Hierarchy 5 · Execution 4 · Specificity 4 · Restraint 5 · Variety 3
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { display } from "@/components/marketing/primitives";
import { marketingFontVars } from "@/components/marketing/fonts";
import { Nav } from "@/components/marketing/nav";

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={`${marketingFontVars} flex min-h-dvh flex-col bg-background`}>
      <Nav hideAuthActions />
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-sm space-y-6">
          <section
            aria-labelledby="auth-title"
            className="space-y-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8"
          >
            <div className="space-y-2 text-center">
              <h1
                id="auth-title"
                className={`${display} text-2xl font-semibold tracking-[-0.02em]`}
              >
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
            {children}
          </section>
          <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-xs leading-relaxed text-muted-foreground">
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
          </p>
        </div>
      </main>
    </div>
  );
}
