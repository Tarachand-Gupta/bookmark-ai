"use client";
import { useEffect, useState } from "react";
import { extensionAuthorizationText, observeExtensionAuthorization, type ExtensionAuthorizationStatus } from "@/lib/extension-authorization-status";
export default function ExtensionCallback() {
  const [status, setStatus] = useState<ExtensionAuthorizationStatus>("waiting");
  useEffect(() => observeExtensionAuthorization(document, setStatus), []);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-xl font-semibold">Bookmark AI extension</h1>
      <p className="mt-4" role="status">{extensionAuthorizationText[status]}</p>
    </main>
  );
}
