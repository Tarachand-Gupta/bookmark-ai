import { Suspense } from "react";
import { LibraryPage } from "@/components/library/library-page";

export default function Home() {
  return (
    <Suspense>
      <LibraryPage />
    </Suspense>
  );
}
