"use client";
import { useEffect, useState } from "react";
import { getBrowserSupabase, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Factor = { id: string; friendly_name?: string; status: string };
export function AccountFactors() {
  const { session } = useAuth();
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
    const { data, error } = await getBrowserSupabase().auth.mfa.listFactors();
    if (error) throw error;
    setFactors(data.totp);
  }
  useEffect(() => {
    void load().catch(() => setError("Security settings could not be loaded."));
  }, [session?.user.id]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch {
      setError("This security action could not be completed. You may need to sign in again.");
    } finally {
      setBusy(false);
    }
  }
  async function enroll() {
    const { data, error } = await getBrowserSupabase().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator",
    });
    if (error) throw error;
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
    setEnrollment(null);
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
    <div className="space-y-4 border-t pt-4">
      <h3 className="font-medium">Connected accounts</h3>
      <ul className="space-y-2">
        {session?.user.identities?.map((identity) => (
          <li className="flex items-center justify-between gap-2 text-sm" key={identity.id}>
            <span>{identity.provider}</span>
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
                  })
                }
              >
                Disconnect
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => link("google"))}
        >
          Connect Google
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => link("apple"))}
        >
          Connect Apple
        </Button>
      </div>
      <h3 className="font-medium">Two-factor authentication</h3>
      <p className="text-xs text-muted-foreground">
        Use an authenticator app to protect your account.
      </p>
      <ul>
        {factors
          .filter((f) => f.status === "verified")
          .map((factor) => (
            <li className="flex items-center justify-between py-2 text-sm" key={factor.id}>
              <span>{factor.friendly_name || "Authenticator"}</span>
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
                    await load();
                  })
                }
              >
                Remove
              </Button>
            </li>
          ))}
      </ul>
      {!enrollment && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(enroll)}>
          Add authenticator
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
            <select
              aria-label="Authenticator"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded border bg-background p-2"
            >
              <option value="">Choose authenticator</option>
              {factors
                .filter((f) => f.status === "verified")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.friendly_name || "Authenticator"}
                  </option>
                ))}
            </select>
          )}
          <Input
            aria-label="Authenticator code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <Button size="sm" disabled={busy || !selected || code.length !== 6}>
            Verify
          </Button>
          {enrollment && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void run(async () => {
                  await getBrowserSupabase().auth.mfa.unenroll({ factorId: enrollment.id });
                  setEnrollment(null);
                  setCode("");
                })
              }
            >
              Cancel setup
            </Button>
          )}
        </form>
      )}
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
    </div>
  );
}
