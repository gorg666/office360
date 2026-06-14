#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_APP_PATH = "/Applications/Office360.app";
const DEFAULT_BUNDLE_ID = "com.office360.desktop";
const DEFAULT_PROCESS_NAME = "office360";
const DEFAULT_SCREENSHOT = "artifacts/desktop-smoke/office360.png";
const SCENARIOS = new Set(["app-visible", "add-account-exchange"]);

function parseArgs(argv) {
  const args = {
    appPath: DEFAULT_APP_PATH,
    bundleId: DEFAULT_BUNDLE_ID,
    processName: DEFAULT_PROCESS_NAME,
    screenshot: DEFAULT_SCREENSHOT,
    scenario: "app-visible",
    hideApps: ["Code", "Google Chrome"],
    launch: true,
    restart: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app") args.appPath = argv[++i];
    else if (arg === "--bundle-id") args.bundleId = argv[++i];
    else if (arg === "--process") args.processName = argv[++i];
    else if (arg === "--screenshot") args.screenshot = argv[++i];
    else if (arg === "--scenario") args.scenario = argv[++i];
    else if (arg === "--hide-app") args.hideApps.push(argv[++i]);
    else if (arg === "--no-default-hide") args.hideApps = [];
    else if (arg === "--no-launch") args.launch = false;
    else if (arg === "--restart") args.restart = true;
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!SCENARIOS.has(args.scenario)) {
    throw new Error(`Unknown scenario: ${args.scenario}. Expected one of: ${[...SCENARIOS].join(", ")}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/desktop-smoke.mjs [options]

Launches/focuses the installed Office360 desktop app and captures UI evidence.

Options:
  --app <path>             Installed app bundle path. Default: ${DEFAULT_APP_PATH}
  --bundle-id <id>         macOS bundle id. Default: ${DEFAULT_BUNDLE_ID}
  --process <name>         AX process name. Default: ${DEFAULT_PROCESS_NAME}
  --screenshot <path>      Screenshot output path. Default: ${DEFAULT_SCREENSHOT}
  --scenario <name>        app-visible | add-account-exchange. Default: app-visible
  --hide-app <name>        Hide an additional app before capture. Can repeat.
  --no-default-hide        Do not hide Code/Google Chrome automatically.
  --no-launch             Do not run open -b; only inspect an already running app.
  --restart               Quit the app before launching it.
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout?.trim() ?? "";
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function osascript(script) {
  return run("osascript", ["-e", script], { capture: true });
}

function hideApp(name) {
  const escaped = name.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const script = `tell application "System Events"
  if exists process "${escaped}" then
    set visible of process "${escaped}" to false
  end if
end tell`;
  try {
    osascript(script);
  } catch (error) {
    console.warn(`[desktop-smoke] Could not hide ${name}: ${error.message}`);
  }
}

function quitApp(processName) {
  const escaped = processName.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const script = `tell application "System Events"
  if exists process "${escaped}" then
    tell process "${escaped}" to set frontmost to true
    keystroke "q" using command down
  end if
end tell`;
  try {
    osascript(script);
    execFileSync("sleep", ["1"]);
  } catch (error) {
    console.warn(`[desktop-smoke] Could not quit ${processName}: ${error.message}`);
  }
}

function getProcessInfo(processName) {
  const escaped = processName.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const script = `tell application "System Events"
  if not (exists process "${escaped}") then
    return "missing"
  end if
  tell process "${escaped}"
    set frontmost to true
    if (count of windows) is 0 then
      return "nowindows"
    end if
    perform action "AXRaise" of window 1
    set p to position of window 1
    set s to size of window 1
    set windowTitle to name of window 1
    return windowTitle & "|" & (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
  end tell
end tell`;
  return osascript(script);
}

function getAxContents(processName) {
  const escaped = processName.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const script = `tell application "System Events"
  if not (exists process "${escaped}") then return ""
  tell process "${escaped}" to return entire contents of window 1
end tell`;
  return osascript(script);
}

function pressEscape(processName) {
  const escaped = processName.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  osascript(`tell application "System Events"
  if exists process "${escaped}" then
    tell process "${escaped}" to set frontmost to true
    key code 53
  end if
end tell`);
}

function openAddAccount(processName) {
  const escaped = processName.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const script = `tell application "System Events"
  tell process "${escaped}"
    set frontmost to true
    set rootElement to UI element 1 of scroll area 1 of group 1 of group 1 of window 1
    if exists UI element "Add Account" of rootElement then
      return "already-open"
    end if
    try
      set accountButton to first button of group 1 of rootElement whose name contains "unread emails"
      click accountButton
      delay 0.4
    on error
      return "missing-account-switcher"
    end try
    try
      set addButton to first button of group 1 of rootElement whose name is "Add account"
      click addButton
      delay 0.4
      return "opened"
    on error
      return "missing-add-account"
    end try
  end tell
end tell`;
  const result = osascript(script);
  if (result !== "already-open" && result !== "opened") {
    throw new Error(`Could not open Add Account modal: ${result}`);
  }
  return result;
}

function assertContains(haystack, needle) {
  if (!haystack.includes(needle)) {
    throw new Error(`Expected AX contents to include: ${needle}`);
  }
}

function assertNotContains(haystack, needle) {
  if (haystack.includes(needle)) {
    throw new Error(`Expected AX contents not to include: ${needle}`);
  }
}

function runScenario(name, processName) {
  if (name === "app-visible") return { scenario: name };

  if (name === "add-account-exchange") {
    pressEscape(processName);
    const openResult = openAddAccount(processName);
    const contents = getAxContents(processName);
    assertContains(contents, "Add Account");
    assertContains(contents, "IMAP / SMTP");
    assertContains(contents, "IMAP/SMTP, including Outlook via Microsoft OAuth. This is not native Exchange.");
    assertNotContains(contents, "Microsoft 365 / Exchange");
    assertNotContains(contents, "Native Graph/Exchange, shared mailboxes, calendar, and contacts are planned");
    return { scenario: name, openResult };
  }

  throw new Error(`Unhandled scenario: ${name}`);
}

function captureScreenshot(path) {
  const out = resolve(path);
  mkdirSync(dirname(out), { recursive: true });
  run("screencapture", ["-x", out], { capture: true });
  return out;
}

function assertScreenshot(path) {
  if (!existsSync(path)) throw new Error(`Screenshot was not created: ${path}`);
  const size = statSync(path).size;
  if (size < 10_000) throw new Error(`Screenshot is unexpectedly small: ${size} bytes`);
  return size;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.appPath)) {
    throw new Error(`Installed app not found: ${args.appPath}`);
  }

  if (args.restart) quitApp(args.processName);

  for (const appName of args.hideApps) hideApp(appName);

  if (args.launch) {
    const launchByBundleId = tryRun("open", ["-b", args.bundleId], { capture: true });
    if (!launchByBundleId.ok) {
      const launchByPath = tryRun("open", [args.appPath], { capture: true });
      if (!launchByPath.ok) {
        throw new Error([
          `open -b ${args.bundleId} failed:`,
          launchByBundleId.stderr || launchByBundleId.stdout,
          `open ${args.appPath} failed:`,
          launchByPath.stderr || launchByPath.stdout,
        ].filter(Boolean).join("\n"));
      }
    }
  }

  // Give the Tauri webview a moment to paint after launch/focus.
  execFileSync("sleep", ["2"]);

  const processInfo = getProcessInfo(args.processName);
  if (processInfo === "missing") throw new Error(`Process is not running: ${args.processName}`);
  if (processInfo === "nowindows") throw new Error(`Process has no visible windows: ${args.processName}`);

  const scenarioResult = runScenario(args.scenario, args.processName);
  const screenshotPath = captureScreenshot(args.screenshot);
  const screenshotBytes = assertScreenshot(screenshotPath);

  console.log(JSON.stringify({
    ok: true,
    appPath: args.appPath,
    bundleId: args.bundleId,
    processName: args.processName,
    processInfo,
    ...scenarioResult,
    screenshotPath,
    screenshotBytes,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`[desktop-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
