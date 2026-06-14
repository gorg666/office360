import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Download,
  ExternalLink,
  Github,
  Globe,
  Mail,
  RefreshCw,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { collectSupportDebugBundle, saveSupportDebugBundle } from "@/services/diagnostics";
import { APP_NAME_EN } from "@/i18n";
import appIcon from "@/assets/icon.png";

function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-primary bg-bg-primary px-5 py-4 shadow-sm">
      <div className={`flex items-start justify-between gap-4 ${children ? "mb-4" : ""}`}>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function DefinitionList({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(11rem,14rem)_1fr] gap-x-8 gap-y-3">
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="text-sm text-text-secondary">{item.label}</dt>
          <dd className="text-sm font-medium text-text-primary tabular-nums">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function SettingsLinkRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 bg-bg-primary px-4 py-2.5 text-left transition-colors hover:bg-bg-hover"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-primary bg-bg-secondary">
        <Icon size={16} className="text-text-tertiary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text-primary">{title}</span>
        <span className="block truncate text-xs text-text-tertiary">{subtitle}</span>
      </span>
      <ExternalLink size={15} className="shrink-0 text-text-tertiary" aria-hidden />
    </button>
  );
}

export function SettingsAboutPanel() {
  const [appVersion, setAppVersion] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");
  const [webviewVersion, setWebviewVersion] = useState("");
  const [platformLabel, setPlatformLabel] = useState("…");
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateCheckDone, setUpdateCheckDone] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [exportingSupportBundle, setExportingSupportBundle] = useState(false);
  const [supportBundleStatus, setSupportBundleStatus] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { getVersion, getTauriVersion } = await import("@tauri-apps/api/app");
        setAppVersion(await getVersion());
        setTauriVersion(await getTauriVersion());
      } catch {
        setAppVersion("—");
        setTauriVersion("—");
      }

      const ua = navigator.userAgent;
      const edgMatch = /Edg\/(\S+)/.exec(ua);
      const chromeMatch = /Chrome\/(\S+)/.exec(ua);
      const webkitMatch = /AppleWebKit\/(\S+)/.exec(ua);
      setWebviewVersion(edgMatch?.[1] ?? chromeMatch?.[1] ?? webkitMatch?.[1] ?? "—");

      try {
        const { platform, arch } = await import("@tauri-apps/plugin-os");
        const p = platform();
        const a = arch();
        const archLabel = a === "aarch64" || a === "arm" ? "ARM" : a === "x86_64" ? "x64" : a;
        if (p === "macos") {
          setPlatformLabel(a === "aarch64" ? "macOS (Apple Silicon)" : `macOS (${archLabel})`);
        } else if (p === "windows") {
          setPlatformLabel(`Windows (${archLabel})`);
        } else if (p === "linux") {
          setPlatformLabel(`Linux (${archLabel})`);
        } else {
          setPlatformLabel(`${p} (${archLabel})`);
        }
      } catch {
        setPlatformLabel("—");
      }

      try {
        const { getAvailableUpdate } = await import("@/services/updateManager");
        const existing = getAvailableUpdate();
        if (existing) setUpdateVersion(existing.version);
      } catch {
        /* browser preview */
      }
    }
    void load();
  }, []);

  const openExternal = async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleCheckForUpdate = async () => {
    setCheckingForUpdate(true);
    setUpdateCheckDone(false);
    setUpdateVersion(null);
    try {
      const { checkForUpdateNow } = await import("@/services/updateManager");
      const result = await checkForUpdateNow();
      if (result) {
        setUpdateVersion(result.version);
      } else {
        setUpdateCheckDone(true);
      }
    } catch (err) {
      console.error("Update check failed:", err);
      setUpdateCheckDone(true);
    } finally {
      setCheckingForUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    try {
      const { installUpdate } = await import("@/services/updateManager");
      await installUpdate();
    } catch (err) {
      console.error("Update install failed:", err);
      setInstallingUpdate(false);
    }
  };

  const handleExportSupportBundle = async () => {
    setExportingSupportBundle(true);
    setSupportBundleStatus(null);
    try {
      const bundle = await collectSupportDebugBundle();
      const result = await saveSupportDebugBundle(bundle);
      if (result.fallback) {
        setSupportBundleStatus("Support bundle downloaded with browser fallback.");
      } else if (result.path) {
        setSupportBundleStatus(`Saved to ${result.path}`);
      } else {
        setSupportBundleStatus("Export canceled.");
      }
    } catch (err) {
      console.error("Support bundle export failed:", err);
      setSupportBundleStatus("Support bundle export failed.");
    } finally {
      setExportingSupportBundle(false);
    }
  };

  const updateAction = updateVersion ? (
    <Button
      variant="primary"
      size="md"
      icon={<Download size={14} />}
      onClick={handleInstallUpdate}
      disabled={installingUpdate}
    >
      {installingUpdate ? "Updating..." : "Update & Restart"}
    </Button>
  ) : (
    <Button
      variant="secondary"
      size="md"
      icon={<RefreshCw size={14} className={checkingForUpdate ? "animate-spin" : ""} />}
      onClick={handleCheckForUpdate}
      disabled={checkingForUpdate}
      className="bg-bg-tertiary text-text-primary border border-border-primary"
    >
      {checkingForUpdate ? "Checking..." : "Check for Updates"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="App Info">
        <DefinitionList
          items={[
            { label: "App version", value: appVersion || "…" },
            { label: "Tauri version", value: tauriVersion || "…" },
            { label: "WebView version", value: webviewVersion || "…" },
            { label: "Platform", value: platformLabel },
          ]}
        />
      </SettingsCard>

      <SettingsCard
        title="Software updates"
        description="Check and install client updates"
        action={updateAction}
      >
        {updateVersion ? (
          <p className="text-sm text-accent">v{updateVersion} available</p>
        ) : updateCheckDone ? (
          <p className="text-sm text-success">Up to date</p>
        ) : (
          <p className="text-sm text-text-tertiary">
            Click &quot;Check for Updates&quot; to find a new version.
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title="Support bundle"
        description="Local JSON export for support. Nothing is sent automatically; secrets and raw mail are redacted."
        action={
          <Button
            variant="secondary"
            size="md"
            icon={<Download size={14} />}
            onClick={() => void handleExportSupportBundle()}
            disabled={exportingSupportBundle}
            className="bg-bg-tertiary text-text-primary border border-border-primary"
          >
            {exportingSupportBundle ? "Exporting..." : "Export"}
          </Button>
        }
      >
        {supportBundleStatus ? (
          <p className="text-sm text-text-secondary">{supportBundleStatus}</p>
        ) : (
          <p className="text-sm text-text-tertiary">
            Includes app metadata, account diagnostics, sync health, and redacted queue state.
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title="Developer Tools"
        description="Open the WebView developer tools inspector"
        action={
          <Button
            variant="secondary"
            size="md"
            onClick={async () => {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("open_devtools");
              } catch (err) {
                console.error("DevTools unavailable:", err);
              }
            }}
            className="bg-bg-tertiary text-text-primary border border-border-primary"
          >
            Open DevTools
          </Button>
        }
      />

      <SettingsCard title={APP_NAME_EN}>
        <div className="flex items-start gap-4">
          <img
            src={appIcon}
            alt={APP_NAME_EN}
            className="h-11 w-11 shrink-0 rounded-lg border border-border-primary"
          />
          <div className="min-w-0 space-y-2">
            <div>
              <p className="text-sm font-semibold text-text-primary">{APP_NAME_EN}</p>
              <p className="text-xs text-text-tertiary">
                {appVersion ? `Version ${appVersion}` : "Loading..."}
              </p>
            </div>
            <p className="max-w-prose text-sm leading-relaxed text-text-secondary">
              Corporate desktop email client for work. Mail and settings stay on your device — no
              cloud profile sync.
            </p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Links">
        <div className="divide-y divide-border-primary rounded-md border border-border-primary">
          <SettingsLinkRow
            icon={Globe}
            title="Website"
            subtitle="office360.app"
            onClick={() => openExternal("https://office360.app")}
          />
          <SettingsLinkRow
            icon={Github}
            title="GitHub Repository"
            subtitle="office360/office360"
            onClick={() => openExternal("https://github.com/office360/office360")}
          />
          <SettingsLinkRow
            icon={Mail}
            title="Contact"
            subtitle="info@office360.app"
            onClick={() => openExternal("mailto:info@office360.app")}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="License">
        <div className="flex items-center gap-2 border-b border-border-primary pb-3">
          <Scale size={15} className="shrink-0 text-text-tertiary" />
          <span className="text-sm font-medium text-text-primary">Office360 Proprietary License</span>
        </div>
        <div className="max-h-40 space-y-3 overflow-y-auto pt-3 text-xs leading-relaxed text-text-secondary">
          <p>
            Office360 is proprietary software. All rights are reserved.
          </p>
          <p className="text-text-tertiary">
            Copyright 2026 Office360. Copying, modification, distribution, sublicensing, sale,
            hosting, disclosure, reverse engineering, decompilation, or disassembly is prohibited
            except under a separate written agreement with Office360. This software is provided
            &quot;as is&quot; without warranties of any kind.
          </p>
        </div>
      </SettingsCard>
    </div>
  );
}
