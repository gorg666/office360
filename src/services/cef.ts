import { invoke } from "@tauri-apps/api/core";

export interface CefBounds { x: number; y: number; width: number; height: number; deviceScaleFactor: number; }
export type DomCommand =
  | { type: "getPageState" }
  | { type: "query" | "read" | "click" | "focus" | "scrollIntoView"; selector: string }
  | { type: "queryAll"; selector: string; limit?: number }
  | { type: "input" | "paste"; selector: string; value: string }
  | { type: "snapshot"; limit?: number }
  | { type: "inspect"; enabled: boolean };
export interface DomCommandResult { requestId?: string; ok: boolean; value?: unknown; error?: string; }
export interface DomSubmission { requestId: string; accepted: boolean; }
export interface CefEvent { type: string; payload: Record<string, unknown>; }

export const cefInitialize = () => invoke<void>("cef_initialize");
export const cefCreate = (url: string, profileKey = "shared") => invoke<void>("cef_create_browser", { url, profileKey });
export const cefSetBounds = (bounds: CefBounds) => invoke<void>("cef_set_bounds", { bounds });
export const cefSetVisible = (visible: boolean) => invoke<void>("cef_set_visible", { visible });
export const cefNavigate = (url: string) => invoke<void>("cef_navigate", { url });
export const cefBack = () => invoke<void>("cef_back");
export const cefForward = () => invoke<void>("cef_forward");
export const cefReload = () => invoke<void>("cef_reload");
export const cefDomCommand = (command: DomCommand) => invoke<DomSubmission>("cef_dom_command", { command });
export const cefPermissionResponse = (id: number, allow: boolean) => invoke<void>("cef_permission_response", { id, allow });
