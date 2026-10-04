"use client";
import { useEffect, useState } from "react";
import { getAccessToken, getBrowserSupabase, signOut, useAuth } from "@/lib/auth";
import { displayName, profileName, profileNameUpdate } from "@/lib/auth-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountFactors } from "./account-factors";
type Device = {
  id: string;
  displayName: string;
  clientType: string;
  browser: string | null;
  os: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  isCurrent: boolean;
};
async function request(path: string, method = "GET", body?: unknown) {
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in to manage your account.");
  const response = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      response.status >= 500
        ? "Account service is temporarily unavailable. Try again."
        : "The request could not be completed. Try again.",
    );
  return response.status === 204 ? null : response.json();
}
export function AccountSecurity() {
  const { session } = useAuth();
  const [name, setName] = useState(
    profileName(session?.user.user_metadata),
  );
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [password, setPassword] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  async function load() {
    const data = await request("/api/auth/sessions");
    setDevices(data.sessions);
  }
  useEffect(() => {
    let active = true;
    void request("/api/auth/sessions")
      .then((data) => {
        if (active) setDevices(data.sessions);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function profile() {
    const { error } = await getBrowserSupabase().auth.updateUser({
      data: profileNameUpdate(name),
    });
    if (error) throw new Error("Profile could not be updated.");
    setMessage("Profile updated.");
  }
  async function changeEmail() {
    const url = new URL("/auth/callback", window.location.origin);
    url.searchParams.set("next", "/app?settings=account");
    const { error } = await getBrowserSupabase().auth.updateUser(
      { email },
      { emailRedirectTo: url.href },
    );
    if (error) throw new Error("Email could not be changed.");
    setMessage("Check your email to confirm the change.");
  }
  async function changePassword() {
    const { error } = await getBrowserSupabase().auth.updateUser({ password });
    if (error)
      throw new Error(
        "Password could not be changed. Try password recovery if fresh authentication is required.",
      );
    setPassword("");
    setMessage("Password updated.");
  }
  async function revoke(device: Device) {
    if (
      !window.confirm(
        device.isCurrent ? "Sign out this device?" : `Sign out ${device.displayName}?`,
      )
    )
      return;
    await request(`/api/auth/sessions/${encodeURIComponent(device.id)}`, "DELETE");
    if (device.isCurrent) {
      await getBrowserSupabase().auth.signOut({ scope: "local" });
      window.location.assign("/sign-in");
    } else await load();
  }
  return (
    <section className="space-y-5 rounded-lg border p-4">
      <h3 className="font-medium">Profile & security</h3>
      <div className="space-y-2">
        <label className="block text-sm">
          Display name
          <Input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <Button size="sm" disabled={busy} onClick={() => void run(profile)}>
          Save name
        </Button>
      </div>
      <div className="space-y-2">
        <label className="block text-sm">
          Email
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !email}
          onClick={() => void run(changeEmail)}
        >
          Change email
        </Button>
      </div>
      <div className="space-y-2">
        <label className="block text-sm">
          New password
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || password.length < 8}
          onClick={() => void run(changePassword)}
        >
          Change password
        </Button>
        <a href="/auth/recovery" className="ml-3 text-sm underline">
          Password recovery
        </a>
      </div>
      <AccountFactors />
      <div>
        <h3 className="font-medium">Signed-in devices</h3>
        <p className="text-xs text-muted-foreground">
          Sign out a device to end its access. Device names are labels only.
        </p>
      </div>
      {loading ? (
        <p role="status">Loading devices…</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {devices.map((device) => (
            <li className="space-y-2 p-3" key={device.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {device.displayName}
                    {device.isCurrent && (
                      <span className="ml-2 text-xs text-muted-foreground">This device</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[device.browser, device.os].filter(Boolean).join(" · ")}{" "}
                    {device.lastActiveAt
                      ? `Last active ${new Date(device.lastActiveAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setRenaming(device.id);
                      setLabel(device.displayName);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => revoke(device))}
                  >
                    Sign out
                  </Button>
                </div>
              </div>
              {renaming === device.id && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await request(
                        `/api/auth/sessions/${encodeURIComponent(device.id)}`,
                        "PATCH",
                        { displayName: displayName(label) },
                      );
                      setRenaming(null);
                      await load();
                    });
                  }}
                >
                  <Input
                    aria-label="Device name"
                    maxLength={80}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                  <Button size="sm" disabled={busy || !displayName(label)}>
                    Save
                  </Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (window.confirm("Sign out every other device?")) {
                await signOut({ scope: "others" });
                await load();
              }
            })
          }
        >
          Sign out other devices
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (window.confirm("Sign out all devices, including this one?"))
                await signOut({ scope: "global" });
            })
          }
        >
          Sign out all devices
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => signOut())}>
          Sign out this device
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
