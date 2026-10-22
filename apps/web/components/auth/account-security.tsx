"use client";
import { useEffect, useRef, useState } from "react";
import { getAccessToken, getBrowserSupabase, signOut, useAuth } from "@/lib/auth";
import { displayName, profileName, profileNameUpdate } from "@/lib/auth-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, KeyRound, LogOut, Monitor, Pencil, Save } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { announceExplicitSignOut } from "@/lib/account-private-state";
import {
  readAccountDevices,
  invalidateAccountSecurity,
  type AccountDevice as Device,
} from "@/lib/account-security-cache";
import { AccountFactors } from "./account-factors";
async function request(accountId: string, path: string, method = "GET", body?: unknown) {
  const token = await getAccessToken();
  const { data } = await getBrowserSupabase().auth.getSession();
  if (!token || data.session?.user.id !== accountId)
    throw new Error("Sign in to manage your account.");
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
  return session ? <AccountSecurityContent key={session.user.id} /> : null;
}
function AccountSecurityContent() {
  const { session } = useAuth();
  const accountId = session!.user.id;
  const mounted = useRef(true);
  const dirtyName = useRef(false);
  const dirtyEmail = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [name, setName] = useState(profileName(session?.user.user_metadata));
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [password, setPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const passwordTrigger = useRef<HTMLButtonElement>(null);
  function disclosePassword(open: boolean) {
    setPasswordOpen(open);
    setPassword("");
    if (!open) passwordTrigger.current?.focus();
  }
  useEffect(() => {
    if (!dirtyName.current) setName(profileName(session?.user.user_metadata));
    if (!dirtyEmail.current) setEmail(session?.user.email ?? "");
  }, [session?.user.user_metadata, session?.user.email]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [deviceError, setDeviceError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  async function load() {
    invalidateAccountSecurity(accountId, "devices");
    if (!mounted.current) return;
    setDeviceError("");
    setLoading(true);
    try {
      const data = await readAccountDevices(accountId);
      if (mounted.current) setDevices(data);
    } catch (error) {
      if (mounted.current) setDeviceError(error instanceof Error ? error.message : "Devices could not be loaded.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void readAccountDevices(accountId)
      .then((data) => {
        if (active) setDevices(data);
      })
      .catch((e) => {
        if (active) setDeviceError(e.message);
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
      const { data } = await getBrowserSupabase().auth.getSession();
      if (!mounted.current || data.session?.user.id !== accountId) return;
      await action();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function profile() {
    const { error } = await getBrowserSupabase().auth.updateUser({
      data: profileNameUpdate(name),
    });
    if (error) throw new Error("Profile could not be updated.");
    if (!mounted.current) return;
    dirtyName.current = false;
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
    if (!mounted.current) return;
    disclosePassword(false);
    setMessage("Password updated.");
  }
  async function revoke(device: Device) {
    if (
      !window.confirm(
        device.isCurrent ? "Sign out this device?" : `Sign out ${device.displayName}?`,
      )
    )
      return;
    await request(accountId, `/api/auth/sessions/${encodeURIComponent(device.id)}`, "DELETE");
    if (device.isCurrent) {
      if (!mounted.current) return;
      announceExplicitSignOut(accountId);
      await getBrowserSupabase().auth.signOut({ scope: "local" });
      window.location.assign("/sign-in");
    } else await load();
  }
  return (
    <div className="space-y-6">
      <section aria-labelledby="account-profile-heading" className="space-y-3">
        <h3 id="account-profile-heading" className="text-sm font-semibold">
          Profile
        </h3>
        <div className="space-y-2">
          <label className="block text-sm">
            Display name
            <Input
              disabled={busy}
              maxLength={80}
              value={name}
              onChange={(e) => {
                dirtyName.current = true;
                setName(e.target.value);
              }}
            />
          </label>
          <Button size="sm" disabled={busy} onClick={() => void run(profile)}>
            <Save aria-hidden className="size-4" /> Save name
          </Button>
        </div>
      </section>
      <AccountFactors
        signInFields={
          <div className="space-y-2">
            <label className="block text-sm">
              Email
              <Input
                disabled={busy}
                type="email"
                value={email}
                onChange={(e) => {
                  dirtyEmail.current = true;
                  setEmail(e.target.value);
                }}
              />
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
        }
      >
        <Collapsible open={passwordOpen} onOpenChange={disclosePassword} className="space-y-3">
          <CollapsibleTrigger asChild>
            <Button ref={passwordTrigger} size="sm" variant="outline" disabled={busy}>
              <KeyRound aria-hidden className="size-4" /> Change password
              <ChevronDown aria-hidden
                className={`size-4 transition-transform ${passwordOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(changePassword);
              }}
            >
              <label className="block space-y-1.5 text-sm">
                <span>New password</span>
                <Input
                  disabled={busy}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy || password.length < 8}>
                  <Save aria-hidden className="size-4" /> Save password
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => disclosePassword(false)}
                >
                  Cancel
                </Button>
                <a href="/auth/recovery" className="text-sm underline">
                  Password recovery
                </a>
              </div>
            </form>
          </CollapsibleContent>
        </Collapsible>
      </AccountFactors>
      <section aria-labelledby="account-devices-heading" className="space-y-3 border-t pt-5">
        <div>
          <h3 id="account-devices-heading" className="text-sm font-semibold">
            Devices
          </h3>
          <p className="text-xs text-muted-foreground">
            Sign out a device to end its access. Device names are labels only.
          </p>
        </div>
        {deviceError && <div role="alert" className="text-sm text-destructive">{deviceError} <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>Retry devices</Button></div>}
        {loading && devices.length === 0 ? (
          <p role="status">Loading devices…</p>
        ) : (
          <ul className="divide-y">
            {devices.map((device) => (
              <li className="space-y-2 py-3" key={device.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Monitor aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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
                      <Pencil aria-hidden className="size-3.5" /> Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => revoke(device))}
                    >
                      <LogOut aria-hidden className="size-3.5" /> Sign out
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
                          accountId,
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
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setRenaming(null)}
                    >
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
            <LogOut aria-hidden className="size-4" /> Sign out other devices
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
            <LogOut aria-hidden className="size-4" /> Sign out all devices
          </Button>
        </div>
      </section>
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
    </div>
  );
}
