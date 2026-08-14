use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CefBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[allow(dead_code)]
    pub device_scale_factor: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomSubmission {
    pub request_id: String,
    pub accepted: bool,
}

#[cfg(windows)]
mod platform {
    use super::*;
    use libloading::Library;
    use std::{ffi::{c_char, c_int, c_void, CStr, CString}, os::windows::ffi::OsStrExt, path::{Path, PathBuf}, sync::Mutex};
    use tauri::path::BaseDirectory;
    use windows::{core::PCWSTR, Win32::System::LibraryLoader::SetDllDirectoryW};

    type EventCallback = unsafe extern "system" fn(*const c_char);
    type Initialize = unsafe extern "C" fn(*mut c_void, *const u16, *const u16, EventCallback) -> c_int;
    type Create = unsafe extern "C" fn(*const c_char, *const u16) -> c_int;
    type SetBounds = unsafe extern "C" fn(c_int, c_int, c_int, c_int);
    type SetVisible = unsafe extern "C" fn(c_int);
    type StringCommand = unsafe extern "C" fn(*const c_char);
    type VoidCommand = unsafe extern "C" fn();
    type DomCommand = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int;
    type PermissionResponse = unsafe extern "C" fn(u64, c_int);

    struct Runtime {
        _library: Library,
        create: Create,
        set_bounds: SetBounds,
        set_visible: SetVisible,
        navigate: StringCommand,
        back: VoidCommand,
        forward: VoidCommand,
        reload: VoidCommand,
        dom_command: DomCommand,
        permission_response: PermissionResponse,
        shutdown: VoidCommand,
        profile_root: PathBuf,
    }

    // The runtime owns the DLL and all copied function pointers.
    unsafe impl Send for Runtime {}
    static RUNTIME: Mutex<Option<Runtime>> = Mutex::new(None);
    static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

    unsafe extern "system" fn event_callback(raw: *const c_char) {
        if raw.is_null() { return; }
        let text = unsafe { CStr::from_ptr(raw) }.to_string_lossy();
        let payload = serde_json::from_str::<serde_json::Value>(&text)
            .unwrap_or_else(|_| serde_json::json!({"type":"error","payload":{"message":"Invalid CEF event"}}));
        if let Some(app) = APP.lock().ok().and_then(|guard| guard.clone()) {
            let _ = app.emit("cef-event", payload);
        }
    }

    fn wide(value: &Path) -> Vec<u16> {
        value.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
        if let Ok(path) = app.path().resolve("cef-runtime", BaseDirectory::Resource) {
            if path.join("office360_cef_host.dll").exists() { return Ok(path); }
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let path = exe.parent().unwrap_or(Path::new(".")).to_path_buf();
        if path.join("office360_cef_host.dll").exists() { Ok(path) }
        else { Err("CEF runtime is not installed. Run scripts/build-cef-host.ps1".into()) }
    }

    pub fn initialize(app: AppHandle) -> Result<(), String> {
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        if guard.is_some() { return Ok(()); }
        let window = app.get_webview_window("main").ok_or("Main window is unavailable")?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let dir = runtime_dir(&app)?;
        let profile = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("cef/telemost-profile");
        std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
        let dir_wide = wide(&dir);
        unsafe { SetDllDirectoryW(PCWSTR(dir_wide.as_ptr())).map_err(|e| e.to_string())?; }
        let library = unsafe { Library::new(dir.join("office360_cef_host.dll")) }.map_err(|e| e.to_string())?;
        macro_rules! load { ($name:literal, $ty:ty) => { *unsafe { library.get::<$ty>($name) }.map_err(|e| e.to_string())? }; }
        let initialize = load!(b"o360_cef_initialize\0", Initialize);
        let create = load!(b"o360_cef_create\0", Create);
        let set_bounds = load!(b"o360_cef_set_bounds\0", SetBounds);
        let set_visible = load!(b"o360_cef_set_visible\0", SetVisible);
        let navigate = load!(b"o360_cef_navigate\0", StringCommand);
        let back = load!(b"o360_cef_back\0", VoidCommand);
        let forward = load!(b"o360_cef_forward\0", VoidCommand);
        let reload = load!(b"o360_cef_reload\0", VoidCommand);
        let dom_command = load!(b"o360_cef_dom_command\0", DomCommand);
        let permission_response = load!(b"o360_cef_permission_response\0", PermissionResponse);
        let shutdown = load!(b"o360_cef_shutdown\0", VoidCommand);
        let profile_wide = wide(&profile);
        let subprocess_wide = wide(&dir.join("office360-cef-subprocess.exe"));
        *APP.lock().map_err(|_| "CEF app lock is poisoned")? = Some(app);
        let ok = unsafe { initialize(hwnd.0, profile_wide.as_ptr(), subprocess_wide.as_ptr(), event_callback) };
        if ok == 0 { return Err("CEF initialization failed".into()); }
        *guard = Some(Runtime { _library: library, create, set_bounds, set_visible, navigate, back, forward, reload, dom_command, permission_response, shutdown, profile_root: profile });
        Ok(())
    }

    fn with_runtime<T>(f: impl FnOnce(&mut Runtime) -> Result<T, String>) -> Result<T, String> {
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        f(guard.as_mut().ok_or("CEF is not initialized")?)
    }

    pub fn create(url: &str, profile_key: &str) -> Result<(), String> { with_runtime(|r| {
        let safe_key: String = profile_key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        if safe_key.is_empty() { return Err("CEF profile key is required".into()); }
        let profile = r.profile_root.join(format!("account-{safe_key}"));
        std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
        let url = CString::new(url).map_err(|_| "Invalid URL")?;
        let profile_wide = wide(&profile);
        if unsafe { (r.create)(url.as_ptr(), profile_wide.as_ptr()) } == 0 { return Err("CEF browser creation failed".into()); }
        Ok(())
    }) }
    pub fn bounds(value: CefBounds) -> Result<(), String> { with_runtime(|r| { let s = value.device_scale_factor.max(0.1); unsafe { (r.set_bounds)((value.x*s).round() as i32,(value.y*s).round() as i32,(value.width*s).round() as i32,(value.height*s).round() as i32) }; Ok(()) }) }
    pub fn visible(value: bool) -> Result<(), String> { with_runtime(|r| { unsafe { (r.set_visible)(value as i32) }; Ok(()) }) }
    pub fn navigate(url: &str) -> Result<(), String> { with_runtime(|r| { let value=CString::new(url).map_err(|_| "Invalid URL")?; unsafe { (r.navigate)(value.as_ptr()) }; Ok(()) }) }
    pub fn back() -> Result<(), String> { with_runtime(|r| { unsafe { (r.back)() }; Ok(()) }) }
    pub fn forward() -> Result<(), String> { with_runtime(|r| { unsafe { (r.forward)() }; Ok(()) }) }
    pub fn reload() -> Result<(), String> { with_runtime(|r| { unsafe { (r.reload)() }; Ok(()) }) }
    pub fn dom(request_id: &str, command: &str) -> Result<bool, String> { with_runtime(|r| { let id=CString::new(request_id).map_err(|_| "Invalid request ID")?; let command=CString::new(command).map_err(|_| "Invalid DOM command")?; Ok(unsafe { (r.dom_command)(id.as_ptr(),command.as_ptr()) } != 0) }) }
    pub fn permission(id: u64, allow: bool) -> Result<(), String> { with_runtime(|r| { unsafe { (r.permission_response)(id,allow as i32) }; Ok(()) }) }
    pub fn close_browser() -> Result<(), String> { visible(false) }
    pub fn has_yandex_session(_: &str) -> Result<bool, String> { Ok(true) }
    pub fn reset_account_profile(_: &str) -> Result<(), String> { Err("Account profile reset is macOS CEF only".into()) }
    pub fn probe_session() -> Result<(), String> { Ok(()) }
    pub fn shutdown() { if let Ok(mut guard)=RUNTIME.lock() { if let Some(runtime)=guard.take() { unsafe { (runtime.shutdown)() }; } } if let Ok(mut app)=APP.lock(){*app=None;} }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use libloading::Library;
    use std::{
        ffi::{c_char, c_int, c_void, CStr, CString},
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };

    type EventCallback = unsafe extern "C" fn(*const c_char);
    type Initialize = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char, *const c_char, *const c_char, EventCallback) -> c_int;
    type Create = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int;
    type SetBounds = unsafe extern "C" fn(c_int, c_int, c_int, c_int);
    type SetVisible = unsafe extern "C" fn(c_int);
    type StringCommand = unsafe extern "C" fn(*const c_char);
    type VoidCommand = unsafe extern "C" fn();
    type StatusCommand = unsafe extern "C" fn() -> c_int;
    type DomCommand = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int;
    type PermissionResponse = unsafe extern "C" fn(u64, c_int);

    struct Runtime {
        _library: Library,
        create: Create,
        set_bounds: SetBounds,
        set_visible: SetVisible,
        navigate: StringCommand,
        back: VoidCommand,
        forward: VoidCommand,
        reload: VoidCommand,
        dom_command: DomCommand,
        permission_response: PermissionResponse,
        close_browser: VoidCommand,
        probe_session: StatusCommand,
        shutdown: VoidCommand,
        profile_root: PathBuf,
        #[allow(dead_code)]
        framework_dir: PathBuf,
        #[allow(dead_code)]
        main_bundle: PathBuf,
        #[allow(dead_code)]
        subprocess: PathBuf,
    }

    unsafe impl Send for Runtime {}
    static RUNTIME: Mutex<Option<Runtime>> = Mutex::new(None);
    static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
    static CEF_SHUTDOWN: AtomicBool = AtomicBool::new(false);
    /// Keeps Chromium Embedded Framework mapped so its malloc-zone shim stays installed.
    static LIBCEF_FRAMEWORK: Mutex<Option<Library>> = Mutex::new(None);

    fn libcef_framework_binary() -> Option<PathBuf> {
        let mut dirs = Vec::new();
        if let Ok(path) = std::env::var("OFFICE360_CEF_RUNTIME") {
            dirs.push(PathBuf::from(path));
        }
        if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
            dirs.push(PathBuf::from(manifest).join("cef-runtime"));
        }
        if let Ok(exe) = std::env::current_exe() {
            let mut dir = exe.parent().unwrap_or(Path::new(".")).to_path_buf();
            for _ in 0..8 {
                dirs.push(dir.join("cef-runtime"));
                dirs.push(dir.join("src-tauri/cef-runtime"));
                if !dir.pop() {
                    break;
                }
            }
        }
        let rel = "Office360CEF.app/Contents/Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework";
        dirs.into_iter().map(|dir| dir.join(rel)).find(|path| path.exists())
    }

    /// Install libcef's malloc-zone shim before any SQLite connection is opened.
    /// Opening sqlx first, then loading CEF, leaves lookaside buffers on the old zone
    /// and later crashes in sqlite3DbMallocRawNN (live IPS 15:23 / 15:33).
    pub fn preload_libcef_allocator() {
        if let Ok(guard) = LIBCEF_FRAMEWORK.lock() {
            if guard.is_some() {
                return;
            }
        }
        let Some(path) = libcef_framework_binary() else {
            eprintln!("[cef-life] LIBCEF_ALLOCATOR_PRELOAD skipped: framework not found");
            return;
        };
        match unsafe { Library::new(&path) } {
            Ok(library) => {
                eprintln!("[cef-life] LIBCEF_ALLOCATOR_PRELOAD ok path={}", path.display());
                if let Ok(mut guard) = LIBCEF_FRAMEWORK.lock() {
                    *guard = Some(library);
                }
            }
            Err(err) => {
                eprintln!(
                    "[cef-life] LIBCEF_ALLOCATOR_PRELOAD fail path={} err={}",
                    path.display(),
                    err
                );
            }
        }
    }

    unsafe extern "C" fn event_callback(raw: *const c_char) {
        if raw.is_null() { return; }
        let text = unsafe { CStr::from_ptr(raw) }.to_string_lossy();
        let payload = serde_json::from_str::<serde_json::Value>(&text)
            .unwrap_or_else(|_| serde_json::json!({"type":"error","payload":{"message":"Invalid CEF event"}}));
        if let Some(app) = APP.lock().ok().and_then(|guard| guard.clone()) {
            let _ = app.emit("cef-event", payload);
        }
    }

    fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
        if let Ok(path) = std::env::var("OFFICE360_CEF_RUNTIME") {
            let path = PathBuf::from(path);
            if path.join("liboffice360_cef_host.dylib").exists() { return Ok(path); }
        }
        if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
            let path = PathBuf::from(manifest).join("cef-runtime");
            if path.join("liboffice360_cef_host.dylib").exists() { return Ok(path); }
        }
        if let Ok(path) = app.path().resolve("cef-runtime", tauri::path::BaseDirectory::Resource) {
            if path.join("liboffice360_cef_host.dylib").exists() { return Ok(path); }
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut dir = exe.parent().unwrap_or(Path::new(".")).to_path_buf();
        for _ in 0..8 {
            for candidate in [dir.join("cef-runtime"), dir.join("src-tauri/cef-runtime")] {
                if candidate.join("liboffice360_cef_host.dylib").exists() { return Ok(candidate); }
            }
            if !dir.pop() { break; }
        }
        Err("CEF runtime is not installed. Run scripts/build-cef-host-macos.sh".into())
    }

    pub fn initialize(app: AppHandle) -> Result<(), String> {
        if CEF_SHUTDOWN.load(Ordering::SeqCst) {
            return Err("CEF has already shut down in this process".into());
        }
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        if guard.is_some() { return Ok(()); }
        let window = app.get_webview_window("main").ok_or("Main window is unavailable")?;
        let ns_window = window.ns_window().map_err(|e| e.to_string())?;
        let dir = runtime_dir(&app)?;
        let profile = app.path().app_data_dir().map_err(|e| e.to_string())?.join("cef/telemost-profile");
        std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
        let library = unsafe { Library::new(dir.join("liboffice360_cef_host.dylib")) }.map_err(|e| e.to_string())?;
        macro_rules! load { ($name:literal, $ty:ty) => { *unsafe { library.get::<$ty>($name) }.map_err(|e| e.to_string())? }; }
        let initialize = load!(b"o360_cef_initialize\0", Initialize);
        let create = load!(b"o360_cef_create\0", Create);
        let set_bounds = load!(b"o360_cef_set_bounds\0", SetBounds);
        let set_visible = load!(b"o360_cef_set_visible\0", SetVisible);
        let navigate = load!(b"o360_cef_navigate\0", StringCommand);
        let back = load!(b"o360_cef_back\0", VoidCommand);
        let forward = load!(b"o360_cef_forward\0", VoidCommand);
        let reload = load!(b"o360_cef_reload\0", VoidCommand);
        let dom_command = load!(b"o360_cef_dom_command\0", DomCommand);
        let permission_response = load!(b"o360_cef_permission_response\0", PermissionResponse);
        let close_browser = load!(b"o360_cef_close_browser\0", VoidCommand);
        let probe_session = load!(b"o360_cef_probe_session_cookies\0", StatusCommand);
        let set_isolation = load!(b"o360_cef_set_isolation_script\0", StringCommand);
        let shutdown = load!(b"o360_cef_shutdown\0", VoidCommand);
        let framework_dir = dir.join("Office360CEF.app/Contents/Frameworks/Chromium Embedded Framework.framework");
        let main_bundle = dir.join("Office360CEF.app");
        let subprocess = dir.join("Office360CEF.app/Contents/Frameworks/Office360CEF Helper.app/Contents/MacOS/Office360CEF Helper");
        let profile_c = CString::new(profile.to_string_lossy().as_bytes()).map_err(|_| "Invalid profile path")?;
        let subprocess_c = CString::new(subprocess.to_string_lossy().as_bytes()).map_err(|_| "Invalid helper path")?;
        let framework_c = CString::new(framework_dir.to_string_lossy().as_bytes()).map_err(|_| "Invalid framework path")?;
        let bundle_c = CString::new(main_bundle.to_string_lossy().as_bytes()).map_err(|_| "Invalid bundle path")?;
        *APP.lock().map_err(|_| "CEF app lock is poisoned")? = Some(app);
        log::info!(
            "[cef-life] CEF_INIT_START pid={} subprocess={} bundle={}",
            std::process::id(),
            subprocess.display(),
            main_bundle.display()
        );
        let ok = unsafe {
            initialize(
                ns_window as *mut c_void,
                profile_c.as_ptr(),
                subprocess_c.as_ptr(),
                framework_c.as_ptr(),
                bundle_c.as_ptr(),
                event_callback,
            )
        };
        if ok == 0 {
            log::error!("[cef-life] CEF_INIT_FAIL pid={}", std::process::id());
            return Err("CEF initialization failed".into());
        }
        log::info!("[cef-life] CEF_HOST_READY pid={} cef_ready=false", std::process::id());
        const ISOLATION: &str = include_str!("telemost_surface_isolation.js");
        if let Ok(script) = CString::new(ISOLATION) {
            unsafe { set_isolation(script.as_ptr()) };
        }
        *guard = Some(Runtime {
            _library: library,
            create,
            set_bounds,
            set_visible,
            navigate,
            back,
            forward,
            reload,
            dom_command,
            permission_response,
            close_browser,
            probe_session,
            shutdown,
            profile_root: profile,
            framework_dir,
            main_bundle,
            subprocess,
        });
        Ok(())
    }

    fn with_runtime<T>(f: impl FnOnce(&mut Runtime) -> Result<T, String>) -> Result<T, String> {
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        f(guard.as_mut().ok_or("CEF is not initialized")?)
    }

    pub fn create(url: &str, profile_key: &str) -> Result<(), String> { with_runtime(|r| {
        let safe_key: String = profile_key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        if safe_key.is_empty() { return Err("CEF profile key is required".into()); }
        let profile = r.profile_root.join(format!("account-{safe_key}"));
        std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
        let url = CString::new(url).map_err(|_| "Invalid URL")?;
        let profile_c = CString::new(profile.to_string_lossy().as_bytes()).map_err(|_| "Invalid profile path")?;
        if unsafe { (r.create)(url.as_ptr(), profile_c.as_ptr()) } == 0 { return Err("CEF browser creation failed".into()); }
        Ok(())
    }) }
    pub fn bounds(value: CefBounds) -> Result<(), String> {
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        let Some(runtime) = guard.as_mut() else {
            log::warn!("[cef-life] cef_set_bounds ignored: CEF is not initialized");
            return Ok(());
        };
        unsafe {
            (runtime.set_bounds)(
                value.x.round() as i32,
                value.y.round() as i32,
                value.width.round() as i32,
                value.height.round() as i32,
            )
        };
        Ok(())
    }
    pub fn visible(value: bool) -> Result<(), String> { with_runtime(|r| { unsafe { (r.set_visible)(value as i32) }; Ok(()) }) }
    pub fn navigate(url: &str) -> Result<(), String> { with_runtime(|r| { let value=CString::new(url).map_err(|_| "Invalid URL")?; unsafe { (r.navigate)(value.as_ptr()) }; Ok(()) }) }
    pub fn back() -> Result<(), String> { with_runtime(|r| { unsafe { (r.back)() }; Ok(()) }) }
    pub fn forward() -> Result<(), String> { with_runtime(|r| { unsafe { (r.forward)() }; Ok(()) }) }
    pub fn reload() -> Result<(), String> { with_runtime(|r| { unsafe { (r.reload)() }; Ok(()) }) }
    pub fn dom(request_id: &str, command: &str) -> Result<bool, String> { with_runtime(|r| { let id=CString::new(request_id).map_err(|_| "Invalid request ID")?; let command=CString::new(command).map_err(|_| "Invalid DOM command")?; Ok(unsafe { (r.dom_command)(id.as_ptr(),command.as_ptr()) } != 0) }) }
    pub fn permission(id: u64, allow: bool) -> Result<(), String> { with_runtime(|r| { unsafe { (r.permission_response)(id,allow as i32) }; Ok(()) }) }
    pub fn close_browser() -> Result<(), String> { with_runtime(|r| { unsafe { (r.close_browser)() }; Ok(()) }) }

    fn safe_profile_key(profile_key: &str) -> Result<String, String> {
        let safe_key: String = profile_key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        if safe_key.is_empty() { return Err("CEF profile key is required".into()); }
        Ok(safe_key)
    }

    fn account_profile_dir(profile_root: &Path, profile_key: &str) -> Result<PathBuf, String> {
        Ok(profile_root.join(format!("account-{}", safe_profile_key(profile_key)?)))
    }

    /// Disk evidence only: cookie host_key + name. Never reads cookie values.
    fn disk_cookie_summary(profile_dir: &Path) -> Result<(bool, Vec<(String, String)>), String> {
        let cookies_db = profile_dir.join("Cookies");
        if !cookies_db.exists() {
            return Ok((false, Vec::new()));
        }
        let output = std::process::Command::new("/usr/bin/sqlite3")
            .arg(cookies_db.as_os_str())
            .arg("SELECT host_key, name FROM cookies WHERE host_key LIKE '%yandex%' OR host_key LIKE '%ya.ru%' ORDER BY host_key, name;")
            .output();
        let output = match output {
            Ok(out) if out.status.success() => out,
            // Locked DB while CEF is running, or missing sqlite3: treat as no auth evidence.
            _ => return Ok((false, Vec::new())),
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let mut cookies = Vec::new();
        let mut authenticated = false;
        for line in text.lines() {
            let mut parts = line.splitn(2, '|');
            let host = parts.next().unwrap_or("").trim();
            let name = parts.next().unwrap_or("").trim();
            if host.is_empty() || name.is_empty() { continue; }
            if name == "Session_id" || name == "sessionid2" || name == "Session_id2" {
                authenticated = true;
            }
            cookies.push((host.to_string(), name.to_string()));
        }
        Ok((authenticated, cookies))
    }

    pub fn has_yandex_session(profile_key: &str) -> Result<bool, String> {
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        let Some(runtime) = guard.as_mut() else {
            return Ok(false);
        };
        let dir = account_profile_dir(&runtime.profile_root, profile_key)?;
        let (authenticated, _) = disk_cookie_summary(&dir)?;
        Ok(authenticated)
    }

    pub fn reset_account_profile(profile_key: &str) -> Result<(), String> {
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        let Some(runtime) = guard.as_mut() else {
            return Err("CEF is not initialized".into());
        };
        unsafe { (runtime.close_browser)() };
        let dir = account_profile_dir(&runtime.profile_root, profile_key)?;
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("Failed to wipe Telemost CEF profile: {e}"))?;
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn probe_session() -> Result<(), String> {
        with_runtime(|r| {
            if unsafe { (r.probe_session)() } == 0 { return Err("CEF_NOT_READY".into()); }
            Ok(())
        })
    }

    pub fn shutdown() {
        CEF_SHUTDOWN.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = RUNTIME.lock() {
            if let Some(runtime) = guard.take() {
                log::info!("[cef-life] MAIN_EXIT calling o360_cef_shutdown pid={}", std::process::id());
                unsafe { (runtime.shutdown)() };
            }
        }
        if let Ok(mut app) = APP.lock() { *app = None; }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;
    fn unavailable<T>() -> Result<T,String>{Err("Embedded Telemost is available only on Windows x64".into())}
    pub fn initialize(_:AppHandle)->Result<(),String>{unavailable()} pub fn create(_: &str,_:&str)->Result<(),String>{unavailable()}
    pub fn bounds(_:CefBounds)->Result<(),String>{unavailable()} pub fn visible(_:bool)->Result<(),String>{unavailable()}
    pub fn navigate(_: &str)->Result<(),String>{unavailable()} pub fn back()->Result<(),String>{unavailable()} pub fn forward()->Result<(),String>{unavailable()} pub fn reload()->Result<(),String>{unavailable()}
    pub fn dom(_: &str,_:&str)->Result<bool,String>{unavailable()} pub fn permission(_:u64,_:bool)->Result<(),String>{unavailable()}
    pub fn close_browser()->Result<(),String>{unavailable()}
    pub fn has_yandex_session(_: &str)->Result<bool,String>{Ok(false)}
    pub fn reset_account_profile(_: &str)->Result<(),String>{unavailable()}
    pub fn probe_session()->Result<(),String>{unavailable()}
    pub fn shutdown(){}
}

#[cfg(target_os = "macos")]
pub fn preload_libcef_allocator() {
    platform::preload_libcef_allocator();
}

#[tauri::command] pub fn cef_initialize(app:AppHandle)->Result<(),String>{platform::initialize(app)}
#[tauri::command] pub fn cef_create_browser(url:String,profile_key:String)->Result<(),String>{platform::create(&url,&profile_key)}
#[tauri::command] pub fn cef_set_bounds(bounds:CefBounds)->Result<(),String>{platform::bounds(bounds)}
#[tauri::command] pub fn cef_set_visible(visible:bool)->Result<(),String>{platform::visible(visible)}
#[tauri::command] pub fn cef_navigate(url:String)->Result<(),String>{platform::navigate(&url)}
#[tauri::command] pub fn cef_back()->Result<(),String>{platform::back()}
#[tauri::command] pub fn cef_forward()->Result<(),String>{platform::forward()}
#[tauri::command] pub fn cef_reload()->Result<(),String>{platform::reload()}
#[tauri::command] pub fn cef_dom_command(command:serde_json::Value)->Result<DomSubmission,String>{let request_id=uuid::Uuid::new_v4().to_string();let encoded=serde_json::to_string(&command).map_err(|e|e.to_string())?;let accepted=platform::dom(&request_id,&encoded)?;Ok(DomSubmission{request_id,accepted})}
#[tauri::command] pub fn cef_permission_response(id:u64,allow:bool)->Result<(),String>{platform::permission(id,allow)}
#[tauri::command] pub fn cef_close_browser()->Result<(),String>{platform::close_browser()}
#[tauri::command] pub fn cef_has_yandex_session(profile_key:String)->Result<bool,String>{platform::has_yandex_session(&profile_key)}
#[tauri::command] pub fn cef_reset_account_profile(profile_key:String)->Result<(),String>{platform::reset_account_profile(&profile_key)}
#[tauri::command] pub fn cef_probe_session()->Result<(),String>{platform::probe_session()}
#[tauri::command] pub fn cef_shutdown()->Result<(),String>{platform::shutdown(); Ok(())}
pub fn shutdown(){platform::shutdown()}
