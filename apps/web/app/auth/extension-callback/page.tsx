"use client";
import { useEffect, useState } from "react";
export default function ExtensionCallback() {
  const [status, setStatus] = useState("Completing extension authorization…");
  useEffect(() => {
    const callback = (event: Event) =>
      setStatus(
        (event as CustomEvent).detail === "complete"
          ? "Extension connected. You can close this tab."
          : "Authorization failed. Start again from the extension.",
      );
    document.addEventListener("bookmark-extension-authorization", callback);
    const timer = setTimeout(
      () =>
        setStatus(
          "Open the Bookmark AI extension to check the connection. If it is not connected, start authorization again.",
        ),
      10000,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("bookmark-extension-authorization", callback);
    };
  }, []);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-xl font-semibold">Bookmark AI extension</h1>
      <p className="mt-4">{status}</p>
    </main>
  );
}
