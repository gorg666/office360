use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CefBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
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
    type Create = unsafe extern "C" fn(*const c_char) -> c_int;
    type SetBounds = unsafe extern "C" fn(c_int, c_int, c_int, c_int);
    type SetVisible = unsafe extern "C" fn(c_int);
    type StringCommand = unsafe extern "C" fn(*const c_char);
    type VoidCommand = unsafe extern "C" fn();
    type ClearSession = unsafe extern "C" fn(*const c_char);
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
        clear_session: ClearSession,
        dom_command: DomCommand,
        permission_response: PermissionResponse,
        shutdown: VoidCommand,
        browser_created: bool,
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
        let clear_session = load!(b"o360_cef_clear_session\0", ClearSession);
        let dom_command = load!(b"o360_cef_dom_command\0", DomCommand);
        let permission_response = load!(b"o360_cef_permission_response\0", PermissionResponse);
        let shutdown = load!(b"o360_cef_shutdown\0", VoidCommand);
        let profile_wide = wide(&profile);
        let subprocess_wide = wide(&dir.join("office360-cef-subprocess.exe"));
        *APP.lock().map_err(|_| "CEF app lock is poisoned")? = Some(app);
        let ok = unsafe { initialize(hwnd.0, profile_wide.as_ptr(), subprocess_wide.as_ptr(), event_callback) };
        if ok == 0 { return Err("CEF initialization failed".into()); }
        *guard = Some(Runtime { _library: library, create, set_bounds, set_visible, navigate, back, forward, reload, clear_session, dom_command, permission_response, shutdown, browser_created: false });
        Ok(())
    }

    fn with_runtime<T>(f: impl FnOnce(&mut Runtime) -> Result<T, String>) -> Result<T, String> {
        let mut guard = RUNTIME.lock().map_err(|_| "CEF runtime lock is poisoned")?;
        f(guard.as_mut().ok_or("CEF is not initialized")?)
    }

    pub fn create(url: &str) -> Result<(), String> { with_runtime(|r| {
        if r.browser_created {
            let value = CString::new(url).map_err(|_| "Invalid URL")?;
            unsafe { (r.navigate)(value.as_ptr()) };
            return Ok(());
        }
        let url = CString::new(url).map_err(|_| "Invalid URL")?;
        if unsafe { (r.create)(url.as_ptr()) } == 0 { return Err("CEF browser creation failed".into()); }
        r.browser_created = true; Ok(())
    }) }
    pub fn bounds(value: CefBounds) -> Result<(), String> { with_runtime(|r| { let s = value.device_scale_factor.max(0.1); unsafe { (r.set_bounds)((value.x*s).round() as i32,(value.y*s).round() as i32,(value.width*s).round() as i32,(value.height*s).round() as i32) }; Ok(()) }) }
    pub fn visible(value: bool) -> Result<(), String> { with_runtime(|r| { unsafe { (r.set_visible)(value as i32) }; Ok(()) }) }
    pub fn navigate(url: &str) -> Result<(), String> { with_runtime(|r| { let value=CString::new(url).map_err(|_| "Invalid URL")?; unsafe { (r.navigate)(value.as_ptr()) }; Ok(()) }) }
    pub fn back() -> Result<(), String> { with_runtime(|r| { unsafe { (r.back)() }; Ok(()) }) }
    pub fn forward() -> Result<(), String> { with_runtime(|r| { unsafe { (r.forward)() }; Ok(()) }) }
    pub fn reload() -> Result<(), String> { with_runtime(|r| { unsafe { (r.reload)() }; Ok(()) }) }
    pub fn clear_session(next_url: &str) -> Result<(), String> { with_runtime(|r| { let value=CString::new(next_url).map_err(|_| "Invalid URL")?; unsafe { (r.clear_session)(value.as_ptr()) }; Ok(()) }) }
    pub fn dom(request_id: &str, command: &str) -> Result<bool, String> { with_runtime(|r| { let id=CString::new(request_id).map_err(|_| "Invalid request ID")?; let command=CString::new(command).map_err(|_| "Invalid DOM command")?; Ok(unsafe { (r.dom_command)(id.as_ptr(),command.as_ptr()) } != 0) }) }
    pub fn permission(id: u64, allow: bool) -> Result<(), String> { with_runtime(|r| { unsafe { (r.permission_response)(id,allow as i32) }; Ok(()) }) }
    pub fn shutdown() { if let Ok(mut guard)=RUNTIME.lock() { if let Some(runtime)=guard.take() { unsafe { (runtime.shutdown)() }; } } if let Ok(mut app)=APP.lock(){*app=None;} }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    fn unavailable<T>() -> Result<T,String>{Err("Embedded Telemost is available only on Windows x64".into())}
    pub fn initialize(_:AppHandle)->Result<(),String>{unavailable()} pub fn create(_: &str)->Result<(),String>{unavailable()}
    pub fn bounds(_:CefBounds)->Result<(),String>{unavailable()} pub fn visible(_:bool)->Result<(),String>{unavailable()}
    pub fn navigate(_: &str)->Result<(),String>{unavailable()} pub fn back()->Result<(),String>{unavailable()} pub fn forward()->Result<(),String>{unavailable()} pub fn reload()->Result<(),String>{unavailable()} pub fn clear_session(_: &str)->Result<(),String>{unavailable()}
    pub fn dom(_: &str,_:&str)->Result<bool,String>{unavailable()} pub fn permission(_:u64,_:bool)->Result<(),String>{unavailable()} pub fn shutdown(){}
}

#[tauri::command] pub fn cef_initialize(app:AppHandle)->Result<(),String>{platform::initialize(app)}
#[tauri::command] pub fn cef_create_browser(url:String)->Result<(),String>{platform::create(&url)}
#[tauri::command] pub fn cef_set_bounds(bounds:CefBounds)->Result<(),String>{platform::bounds(bounds)}
#[tauri::command] pub fn cef_set_visible(visible:bool)->Result<(),String>{platform::visible(visible)}
#[tauri::command] pub fn cef_navigate(url:String)->Result<(),String>{platform::navigate(&url)}
#[tauri::command] pub fn cef_back()->Result<(),String>{platform::back()}
#[tauri::command] pub fn cef_forward()->Result<(),String>{platform::forward()}
#[tauri::command] pub fn cef_reload()->Result<(),String>{platform::reload()}
#[tauri::command] pub fn cef_clear_session(next_url:String)->Result<(),String>{platform::clear_session(&next_url)}
#[tauri::command] pub fn cef_dom_command(command:serde_json::Value)->Result<DomSubmission,String>{let request_id=uuid::Uuid::new_v4().to_string();let encoded=serde_json::to_string(&command).map_err(|e|e.to_string())?;let accepted=platform::dom(&request_id,&encoded)?;Ok(DomSubmission{request_id,accepted})}
#[tauri::command] pub fn cef_permission_response(id:u64,allow:bool)->Result<(),String>{platform::permission(id,allow)}
pub fn shutdown(){platform::shutdown()}
