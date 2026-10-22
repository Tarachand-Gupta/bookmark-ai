"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getBrowserSupabase, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Plus, ShieldCheck, Smartphone, Trash2, Unlink } from "lucide-react";
import { GoogleIcon, AppleIcon } from "./provider-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  readAccountFactors,
  invalidateAccountSecurity,
  type AccountFactor as Factor,
} from "@/lib/account-security-cache";
function ProviderIcon({ provider }: { provider: string }) {
  return provider === "google" ? (
    <GoogleIcon className="size-4" />
  ) : provider === "apple" ? (
    <AppleIcon className="size-4" />
  ) : (
    <Mail aria-hidden className="size-4" />
  );
}
const providerLabel = (provider: string) =>
  ({ google: "Google", apple: "Apple", email: "Email" })[provider] ?? provider;

export function AccountFactors(props: { signInFields?: ReactNode; children?: ReactNode }) {
  const { session } = useAuth();
  return session ? <AccountFactorsContent key={session.user.id} {...props} /> : null;
}
function AccountFactorsContent({
  signInFields,
  children,
}: {
  signInFields?: ReactNode;
  children?: ReactNode;
}) {
  const { session } = useAuth();
  const accountId = session!.user.id;
  const mounted = useRef(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(
    null,
  );
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    invalidateAccountSecurity(accountId, "factors");
    if (!mounted.current) return;
    const data = await readAccountFactors(accountId);
    if (mounted.current) setFactors(data);
  }
  useEffect(() => {
    mounted.current = true;
    void readAccountFactors(accountId)
      .then((data) => {
        if (mounted.current) setFactors(data);
      })
      .catch(() => {
        if (mounted.current) setLoadError("Authenticators could not be loaded.");
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [accountId]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await getBrowserSupabase().auth.getSession();
      if (!mounted.current || data.session?.user.id !== accountId) return;
      await action();
    } catch {
      if (mounted.current)
        setError("This security action could not be completed. You may need to sign in again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function enroll() {
    const { data, error } = await getBrowserSupabase().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator",
    });
    if (error) throw error;
    invalidateAccountSecurity(accountId, "factors");
    if (!mounted.current) return;
    setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setSelected(data.id);
    setCode("");
  }
  async function verify() {
    const { error } = await getBrowserSupabase().auth.mfa.challengeAndVerify({
      factorId: selected,
      code,
    });
    if (error) throw error;
    invalidateAccountSecurity(accountId, "factors");
    if (!mounted.current) return;
    setEnrollment(null);
    setSelected("");
    setCode("");
    await load();
    setMessage("Authenticator verified.");
  }
  async function link(provider: "google" | "apple") {
    const redirectTo = new URL(
      "/auth/callback?next=%2Fapp%3Fsettings%3Daccount",
      window.location.origin,
    ).href;
    const { error } = await getBrowserSupabase().auth.linkIdentity({
      provider,
      options: { redirectTo },
    });
    if (error) throw error;
  }
  return (
    <>
      <section aria-labelledby="account-signin-heading" className="space-y-4 border-t pt-5">
        <h3 id="account-signin-heading" className="text-sm font-semibold">
          Sign-in methods
        </h3>
        {signInFields}
        <h4 className="text-sm font-medium">Connected accounts</h4>
        <ul className="space-y-2">
          {session?.user.identities?.map((identity) => (
            <li className="flex items-center justify-between gap-2 text-sm" key={identity.id}>
              <span className="flex items-center gap-2">
                <ProviderIcon provider={identity.provider} />
                {providerLabel(identity.provider)}
              </span>
              {identity.provider !== "email" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!window.confirm(`Disconnect ${identity.provider}?`)) return;
                      const { error } = await getBrowserSupabase().auth.unlinkIdentity(identity);
                      if (error) throw error;
                      invalidateAccountSecurity(accountId, "factors");
                    })
                  }
                >
                  <Unlink aria-hidden className="size-3.5" /> Disconnect
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy || session?.user.identities?.some((identity) => identity.provider === "google")
            }
            onClick={() => void run(() => link("google"))}
          >
            <GoogleIcon className="size-4" /> Connect Google
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy || session?.user.identities?.some((identity) => identity.provider === "apple")
            }
            onClick={() => void run(() => link("apple"))}
          >
            <AppleIcon className="size-4" /> Connect Apple
          </Button>
        </div>
      </section>
      <section aria-labelledby="account-security-heading" className="space-y-4 border-t pt-5">
        <h3 id="account-security-heading" className="text-sm font-semibold">
          Security
        </h3>
        {children}
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck aria-hidden className="size-4" />
            Two-factor authentication
          </h4>
          <p className="text-xs text-muted-foreground">
            Use an authenticator app to protect your account.
          </p>
          {loadError && <div role="alert" className="text-sm text-destructive">{loadError} <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await load(); setLoadError(""); })}>Retry authenticators</Button></div>}
          {loading && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading authenticators…
            </p>
          )}
          <ul>
            {factors
              .filter((f) => f.status === "verified")
              .map((factor) => (
                <li className="flex items-center justify-between py-2 text-sm" key={factor.id}>
                  <span className="flex items-center gap-2">
                    <Smartphone aria-hidden className="size-4" />
                    {factor.friendly_name || "Authenticator"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!window.confirm("Remove this authenticator?")) return;
                        const { error } = await getBrowserSupabase().auth.mfa.unenroll({
                          factorId: factor.id,
                        });
                        if (error) throw error;
                        setSelected("");
                        setCode("");
                        await load();
                      })
                    }
                  >
                    <Trash2 aria-hidden className="size-3.5" /> Remove
                  </Button>
                </li>
              ))}
          </ul>
          {!enrollment && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(enroll)}>
              <Plus aria-hidden className="size-4" /> Add authenticator
            </Button>
          )}
          {enrollment && (
            <div className="space-y-2">
              <p className="text-sm">
                Scan this code with your authenticator app, then enter its six-digit code.
              </p>
              <img
                src={enrollment.qr}
                width={200}
                height={200}
                alt="Authenticator enrollment QR code"
              />
              <details className="text-sm">
                <summary>Enter setup key manually</summary>
                <code className="break-all">{enrollment.secret}</code>
              </details>
            </div>
          )}
          {(enrollment || factors.some((f) => f.status === "verified")) && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(verify);
              }}
            >
              {!enrollment && (
                <Select
                  value={selected}
                  onValueChange={(value) => {
                    setSelected(value);
                    setCode("");
                  }}
                  disabled={busy}
                >
                  <SelectTrigger aria-label="Authenticator" className="w-full sm:w-56">
                    <SelectValue placeholder="Choose authenticator" />
                  </SelectTrigger>
                  <SelectContent>
                    {factors
                      .filter((f) => f.status === "verified")
                      .map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.friendly_name || "Authenticator"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                className="w-full sm:w-40"
                aria-label="Authenticator code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <Button size="sm" disabled={busy || !selected || code.length !== 6}>
                <ShieldCheck aria-hidden className="size-4" /> Verify
              </Button>
              {enrollment && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { error } = await getBrowserSupabase().auth.mfa.unenroll({
                        factorId: enrollment.id,
                      });
                      if (error) throw error;
                      invalidateAccountSecurity(accountId, "factors");
                      if (!mounted.current) return;
                      setEnrollment(null);
                      setSelected("");
                      setCode("");
                      await load();
                    })
                  }
                >
                  Cancel setup
                </Button>
              )}
            </form>
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="text-sm" role="status">
            {message}
          </p>
        )}
      </section>
    </>
  );
}
