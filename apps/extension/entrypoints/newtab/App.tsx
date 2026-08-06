import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/chrome-extension";
import type { NewTabSettings, NewTabTemplate, NewTabWizardData } from "@bookmark-ai/types";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import {
  activateTemplate,
  deleteTemplate,
  fetchNewTabSettings,
  fetchTemplates,
  fetchWizard,
  patchNewTabSettings,
  sendChat,
} from "./api";
import { SandboxIframe } from "./components/SandboxIframe";
import { ChatPopover } from "./components/ChatPopover";
import { Sidebar } from "./components/Sidebar";
import { Wizard } from "./components/Wizard";
import { Spinner } from "../popup/components/Spinner";
import { SignInGate } from "../popup/components/SignInGate";

/**
 * The new-tab page (docs/features/newtab-canvas.md §4.7/§4.9). Renders ONE of:
 *  - the SignInGate (signed out — same gate as the popup),
 *  - the first-run Wizard (no newtab_settings row yet),
 *  - the active template in a sandboxed iframe + sidebar + chat launcher.
 */


export default function App() {
  const { isLoaded, isSignedIn } = useAuth();
  const [settings, setSettings] = useState<NewTabSettings | null | undefined>(undefined);
  const [templates, setTemplates] = useState<NewTabTemplate[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardNote, setWizardNote] = useState<string | null>(null);
  const [wizardChat, setWizardChat] = useState("");
  const [webUrl, setWebUrl] = useState(DEFAULT_WEB_URL);

  // Cold-open parallelism (§4.9): start the wizard fan-out fetch immediately;
  // the bridge's getWizard provider reuses the same promise when the iframe's
  // templates query for data — first.data ≤ one request.
  const wizardPromise = useRef<Promise<NewTabWizardData> | null>(null);
  const getWizard = useCallback((): Promise<NewTabWizardData> => {
    wizardPromise.current ??= fetchWizard();
    return wizardPromise.current;
  }, []);

  // The rendered-data snapshot for the chat popover's activeContext (§4.8).
  // The bridge records every data response per message type; the SandboxIframe
  // exposes its bridge handle through this ref so the popover can snapshot
  // "what's on screen" at send time.
  const bridgeRef = useRef<{ getRenderedSnapshot(): Record<string, unknown> } | null>(null);
  const getRenderedData = useCallback(
    () => bridgeRef.current?.getRenderedSnapshot() ?? {},
    [],
  );

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([fetchTemplates(), fetchNewTabSettings()]);
      setTemplates(t);
      setSettings(s);
      setBootError(null);
    } catch (err) {
      setBootError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void getWizard().catch(() => null); // warm the cache; bridge reuses it
    void load();
    void getWebBaseUrl().then(setWebUrl);
  }, [isLoaded, isSignedIn, getWizard, load]);

  const active = useMemo(() => templates.find((t) => t.isActive) ?? null, [templates]);

  async function handleActivate(id: string) {
    try {
      await activateTemplate(id);
      await load();
    } catch (err) {
      setBootError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteTemplate(id);
      await load();
    } catch (err) {
      setBootError((err as Error).message);
    }
  }

  function handleTemplateApplied(t: NewTabTemplate) {
    // The tool output carries the saved row; swap it in and mark it active in
    // local state. A refetch keeps sidebar ordering consistent.
    setTemplates((list) => {
      const rest = list.filter((x) => x.id !== t.id).map((x) => ({ ...x, isActive: false }));
      return [{ ...t, isActive: t.isActive }, ...rest];
    });
    void load();
  }

  async function handleWizardPick(id: string) {
    setWizardBusy(true);
    setWizardNote(null);
    try {
      await activateTemplate(id);
      await load();
    } catch (err) {
      setWizardNote((err as Error).message);
    } finally {
      setWizardBusy(false);
    }
  }

  async function handleWizardChat() {
    const text = wizardChat.trim();
    if (!text || wizardBusy) return;
    setWizardBusy(true);
    setWizardNote(null);
    try {
      const result = await sendChat({
        messages: [{ id: "w1", role: "user", parts: [{ type: "text", text }] }],
      });
      setWizardChat("");
      if (result.template) {
        setWizardNote(`“${result.template.name}” is ready — taking you there…`);
        window.setTimeout(() => {
          handleTemplateApplied(result.template!);
        }, 900);
      } else {
        setWizardNote(result.text.trim() || "The agent didn't create a template — try rephrasing.");
      }
    } catch (err) {
      setWizardNote((err as Error).message);
    } finally {
      setWizardBusy(false);
    }
  }

  async function toggleSidebarCollapsed() {
    if (settings == null) return;
    const next = !settings.sidebarCollapsed;
    setSettings({ ...settings, sidebarCollapsed: next });
    await patchNewTabSettings({ sidebarCollapsed: next }).catch(() => {
      setSettings((s) => (s ? { ...s, sidebarCollapsed: !next } : s));
    });
  }

  async function toggleLauncherPosition() {
    if (settings == null) return;
    const next = settings.launcherPosition === "bottom-right" ? "bottom-left" : "bottom-right";
    setSettings({ ...settings, launcherPosition: next });
    await patchNewTabSettings({ launcherPosition: next }).catch(() => {
      setSettings((s) => (s ? { ...s, launcherPosition: settings.launcherPosition } : s));
    });
  }

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex h-screen items-center justify-center">
        <SignInGate webUrl={webUrl} />
      </div>
    );
  }

  // First run: no settings row → the wizard. (Presets are already seeded
  // server-side; picking one — or chatting one into existence — writes the
  // settings row and the user never lands here again.)
  if (settings === null) {
    return (
      <Wizard
        presets={templates.filter((t) => t.isPreset)}
        busy={wizardBusy}
        note={wizardNote}
        onPick={(id) => void handleWizardPick(id)}
        chatBox={
          <form
            className="flex w-full max-w-xl items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleWizardChat();
            }}
          >
            <input
              value={wizardChat}
              onChange={(e) => setWizardChat(e.target.value)}
              placeholder='Describe your tab — "a Reddit-style list of my most-saved domains with a search box on top"'
              className="flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={wizardBusy || !wizardChat.trim()}
              className="rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              Send ▸
            </button>
          </form>
        }
      />
    );
  }

  const sidebarCollapsed = settings?.sidebarCollapsed ?? true; // collapsed by default until chosen
  const launcherRight = (settings?.launcherPosition ?? "bottom-right") === "bottom-right";

  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
      {!sidebarCollapsed && (
        <Sidebar
          templates={templates}
          activeId={active?.id ?? null}
          onActivate={(id) => void handleActivate(id)}
          onDelete={(id) => void handleDelete(id)}
          onNewCustom={() => setChatOpen(true)}
        />
      )}

      <main className="relative min-w-0 flex-1">
        {active ? (
          <SandboxIframe template={active} getWizard={getWizard} bridgeRef={bridgeRef} />
        ) : (
          <div className="flex h-full items-center justify-center">
            {bootError ? (
              <p className="text-sm text-destructive">{bootError}</p>
            ) : settings === undefined ? (
              <Spinner />
            ) : (
              <p className="text-sm text-muted-foreground">No active template.</p>
            )}
          </div>
        )}

        {/* Sidebar toggle — always our chrome, never the sandbox's. */}
        <button
          type="button"
          onClick={() => void toggleSidebarCollapsed()}
          title={sidebarCollapsed ? "Show templates" : "Hide templates"}
          className="absolute left-3 top-3 z-10 rounded-lg border bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
        >
          {sidebarCollapsed ? "☰ tabs" : "☰"}
        </button>
      </main>

      {/* Chat launcher (§4.7): position is the user's setting. */}
      <button
        type="button"
        onClick={() => setChatOpen((v) => !v)}
        onContextMenu={(e) => {
          e.preventDefault();
          void toggleLauncherPosition();
        }}
        title="Design your tab (right-click to switch corners)"
        className={`absolute bottom-4 z-20 flex size-11 items-center justify-center rounded-full border bg-background text-lg shadow-lg transition-transform hover:scale-105 ${
          launcherRight ? "right-4" : "left-4"
        }`}
      >
        💬
      </button>

      {chatOpen && (
        <ChatPopover
          activeTemplate={active}
          getRenderedData={getRenderedData}
          onTemplateApplied={handleTemplateApplied}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}
