"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import type { ObservabilityResponse, ObservabilitySurfaces } from "@bookmark-ai/types";
import { updateObservability } from "@/lib/api";
import { Switch } from "./devices-settings";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-section";

/** One switch per traced AI surface, in the order they appear in the trace UI. */
const SURFACE_ROWS: {
  key: keyof ObservabilitySurfaces;
  id: string;
  label: string;
  description: string;
}[] = [
  {
    key: "askAi",
    id: "observability-ask-ai",
    label: "Ask AI",
    description:
      "Chat turns end to end: the model call, every tool invocation, and token usage per generation.",
  },
  {
    key: "sessionSummary",
    id: "observability-session-summary",
    label: "Session summaries",
    description:
      "The AI title and description generated for saved sessions — on save and via Summarize.",
  },
  {
    key: "categorize",
    id: "observability-categorize",
    label: "Categorization",
    description: "The category and tags picked for each saved bookmark.",
  },
  {
    key: "embed",
    id: "observability-embed",
    label: "Embeddings",
    description:
      "Bookmark and session embedding — post-save hooks, the import sweep, and the daily cron.",
  },
  {
    key: "search",
    id: "observability-search",
    label: "Search",
    description: "Library searches, including the query embedding behind hybrid and semantic modes.",
  },
];

/**
 * Settings → Observability (ADMIN-ONLY: the dialog shows this section only
 * after GET /api/admin/observability succeeds, and hands that response in as
 * `initial` — no second fetch here). Five per-surface switches over the
 * platform-wide Langfuse tracing config; each PATCHes its own flag
 * optimistically, exactly like the Sync pane's toggles. With no Langfuse keys
 * on the server the switches render disabled behind a note naming the env
 * vars, so it's obvious why nothing can be traced.
 */
export function ObservabilitySection({ initial }: { initial: ObservabilityResponse }) {
  const [surfaces, setSurfaces] = useState<ObservabilitySurfaces>(initial.surfaces);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { configured, baseUrl } = initial;

  /** Optimistic single-flag PATCH; revert on failure. */
  const toggle = (key: keyof ObservabilitySurfaces, next: boolean) => {
    const prev = surfaces[key];
    setSurfaces((s) => ({ ...s, [key]: next }));
    setBusy(true);
    setError(null);
    updateObservability({ [key]: next })
      .then((response) => setSurfaces(response.surfaces))
      .catch((e: unknown) => {
        setError((e as Error).message);
        setSurfaces((s) => ({ ...s, [key]: prev }));
      })
      .finally(() => setBusy(false));
  };

  return (
    <SettingsSection
      title="Observability"
      icon={Activity}
      description={
        configured ? (
          <>
            Trace AI calls to Langfuse at{" "}
            <strong className="font-medium text-foreground">{baseUrl}</strong> — inputs, outputs,
            token usage and errors, per surface. Platform-wide: these switches apply to every
            user&apos;s traffic.
          </>
        ) : (
          <>Trace AI calls to Langfuse — inputs, outputs, token usage and errors, per surface.</>
        )
      }
    >
      {!configured && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Langfuse isn&apos;t configured on this server. Set{" "}
          <code className="font-mono text-foreground">LANGFUSE_PUBLIC_KEY</code>,{" "}
          <code className="font-mono text-foreground">LANGFUSE_SECRET_KEY</code> and (for a
          self-hosted instance) <code className="font-mono text-foreground">LANGFUSE_BASE_URL</code>{" "}
          in the server&apos;s environment, then restart it to enable tracing.
        </p>
      )}

      {SURFACE_ROWS.map((row, i) => {
        const switchRow = (
          <SettingsRow
            label={row.label}
            htmlFor={row.id}
            muted={!configured}
            control={
              <Switch
                id={row.id}
                checked={surfaces[row.key]}
                disabled={busy || !configured}
                onChange={(next) => toggle(row.key, next)}
              />
            }
            description={row.description}
          />
        );
        // First row sits directly under the header; the rest get the standard
        // hairline + spacing (same rhythm as the Sync pane's second toggle).
        return i === 0 ? (
          <div key={row.key}>{switchRow}</div>
        ) : (
          <SettingsGroup key={row.key} divided>
            {switchRow}
          </SettingsGroup>
        );
      })}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </SettingsSection>
  );
}
