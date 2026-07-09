import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bookmark AI",
  description: "Save bookmarks from any browser — organized automatically by AI.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* shadcn theme keeps Clerk's UserButton + sign-in modal on-brand. */}
        <ClerkProvider appearance={{ theme: shadcn }}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
