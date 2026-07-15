import { Suspense } from "react";
import { LibraryPage } from "@/components/library/library-page";

// The signed-in library app now lives at /app; "/" is the public marketing
// page (see app/page.tsx). All library navigation is pathname-relative
// (usePathname()), so filters, search params, and ?section=sessions deep-links
// work here unchanged.
export default function AppPage() {
  return (
    <Suspense>
      <LibraryPage />
    </Suspense>
  );
}
