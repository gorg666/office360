#include "office360_cef_host.h"
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_display_handler.h"
#include "include/cef_life_span_handler.h"
#include "include/cef_load_handler.h"
#include "include/cef_parser.h"
#include "include/cef_permission_handler.h"
#include "include/cef_request_context.h"
#include "include/cef_request_handler.h"
#include "include/cef_cookie.h"
#include "include/cef_application_mac.h"
#include "include/wrapper/cef_library_loader.h"
#include <AppKit/AppKit.h>
#include <CoreGraphics/CoreGraphics.h>
#include <WebKit/WebKit.h>
#include <crt_externs.h>
#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>
#include <fstream>
#include <mutex>
#include <string>
#include <unistd.h>
#include <vector>

// Chromium messages NSApp with CrAppProtocol selectors during CefDoMessageLoopWork.
// Tauri's NSApplication does not implement them → NSInvalidArgumentException → SIGILL.
static BOOL g_handling_send_event = NO;

@interface NSApplication (O360CefAppProtocol) <CefAppProtocol>
@end

@implementation NSApplication (O360CefAppProtocol)
- (BOOL)isHandlingSendEvent {
  return g_handling_send_event;
}
- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  g_handling_send_event = handlingSendEvent;
}
@end

namespace {
enum class CefRuntimeState : int {
  UNLOADED = 0,
  LOADING_LIBRARY,
  LIBRARY_LOADED,
  CEF_INITIALIZING,
  CEF_READY,
  SHUTTING_DOWN,
  FAILED,
};

std::atomic<CefRuntimeState> g_runtime_state{CefRuntimeState::UNLOADED};
o360_cef_event_callback g_callback = nullptr;
std::mutex g_mutex;
bool g_host_ready = false;
bool g_initialized = false;
bool g_shutdown_done = false;
std::atomic<bool> g_shutting_down{false};
std::atomic<bool> g_pump_ready{false};
std::atomic<uint64_t> g_pump_generation{0};
std::atomic<uintptr_t> g_do_work_addr{0};
bool g_close_in_flight = false;
bool g_abort_reloaded = false;
bool g_visible = false;
bool g_has_bounds = false;
int g_x = 0, g_y = 0, g_width = 1, g_height = 1;
NSWindow* g_window = nil;
NSView* g_container = nil;
CefRefPtr<CefBrowser> g_browser;
CefRefPtr<CefRequestContext> g_context;
bool g_library_loaded = false;
std::string g_isolation;
std::atomic<uint64_t> g_isolation_generation{0};
std::atomic<uint64_t> g_isolation_executed_generation{0};
std::string g_active_profile;
std::string g_root_cache_path;
std::string g_pending_url;
std::string g_pending_profile;
std::string g_init_profile_root;
std::string g_subprocess;
std::string g_framework;
std::string g_bundle;
std::string g_diag_state = "IDLE";
std::string g_lifecycle_log;
int g_init_count = 0;
int g_shutdown_count = 0;

const char* runtime_state_name(CefRuntimeState state) {
  switch (state) {
    case CefRuntimeState::UNLOADED: return "UNLOADED";
    case CefRuntimeState::LOADING_LIBRARY: return "LOADING_LIBRARY";
    case CefRuntimeState::LIBRARY_LOADED: return "LIBRARY_LOADED";
    case CefRuntimeState::CEF_INITIALIZING: return "CEF_INITIALIZING";
    case CefRuntimeState::CEF_READY: return "CEF_READY";
    case CefRuntimeState::SHUTTING_DOWN: return "SHUTTING_DOWN";
    case CefRuntimeState::FAILED: return "FAILED";
  }
  return "UNKNOWN";
}

void set_runtime_state(CefRuntimeState next) {
  const CefRuntimeState previous = g_runtime_state.exchange(next, std::memory_order_acq_rel);
  std::fprintf(stderr, "[cef-runtime] STATE %s -> %s\n",
               runtime_state_name(previous), runtime_state_name(next));
  std::fflush(stderr);
}

bool require_cef_ready(const char* api) {
  const CefRuntimeState state = g_runtime_state.load(std::memory_order_acquire);
  if (state == CefRuntimeState::CEF_READY) return true;
  std::fprintf(stderr, "[cef-runtime] REJECT_NOT_READY api=%s state=%s\n", api, runtime_state_name(state));
  std::fflush(stderr);
  return false;
}

void pump_log(const char* event, const char* extra = nullptr) {
  // Hot-path pump ticks stay quiet in normal runtime.
  (void)event;
  (void)extra;
}

void life(const char* event, const std::string& extra = "{}") {
  using clock = std::chrono::system_clock;
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(clock::now().time_since_epoch()).count();
  char line[1024];
  std::snprintf(line, sizeof(line),
                "[cef-life] ts=%lld event=%s pid=%d ppid=%d extra=%s\n",
                static_cast<long long>(ms), event, getpid(), getppid(), extra.c_str());
  std::fputs(line, stderr);
  std::fflush(stderr);
  if (!g_lifecycle_log.empty()) {
    std::ofstream out(g_lifecycle_log, std::ios::app);
    if (out) out << line;
  }
}

void on_process_exit() { life("MAIN_EXIT"); }

std::string escape_json(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char c : value) {
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default: out += c; break;
    }
  }
  return out;
}

std::string lower_host(std::string host) {
  std::transform(host.begin(), host.end(), host.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return host;
}

std::string redact_url(const std::string& url) {
  if (url.rfind("data:", 0) == 0) return "data:<inline>";
  if (url == "about:blank") return "about:blank";
  CefURLParts parts{};
  if (!CefParseURL(url, parts)) return "invalid-url";
  const std::string scheme = CefString(&parts.scheme).ToString();
  const std::string host = lower_host(CefString(&parts.host).ToString());
  const std::string path = CefString(&parts.path).ToString();
  if ((host == "telemost.yandex.ru" || host == "telemost.360.yandex.ru") && path.rfind("/j/", 0) == 0) {
    return scheme + "://" + host + "/j/<redacted>";
  }
  return scheme + "://" + host + (path.empty() ? "/" : path);
}

bool trusted_url(const std::string& url) {
  CefURLParts parts{};
  if (!CefParseURL(url, parts)) return false;
  const std::string scheme = CefString(&parts.scheme).ToString();
  const std::string host = lower_host(CefString(&parts.host).ToString());
  const bool yandex_ru = host == "yandex.ru" || (host.size() > 10 && host.substr(host.size() - 10) == ".yandex.ru");
  const bool yandex_com = host == "yandex.com" || (host.size() > 11 && host.substr(host.size() - 11) == ".yandex.com");
  const bool ya = host == "ya.ru" || (host.size() > 6 && host.substr(host.size() - 6) == ".ya.ru");
  const bool oauth_callback = scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "::1");
  return (scheme == "https" && (yandex_ru || yandex_com || ya)) || oauth_callback;
}

bool allow_in_cef(const std::string& url) {
  return trusted_url(url);
}

bool http_url(const std::string& url) {
  CefURLParts parts{};
  if (!CefParseURL(url, parts)) return false;
  const auto scheme = CefString(&parts.scheme).ToString();
  return scheme == "https" || scheme == "http";
}

bool telemost_meeting_path(const std::string& url) {
  CefURLParts parts{};
  if (!CefParseURL(url, parts)) return false;
  const std::string host = lower_host(CefString(&parts.host).ToString());
  const std::string path = CefString(&parts.path).ToString();
  return (host == "telemost.yandex.ru" || host == "telemost.360.yandex.ru") && path.rfind("/j/", 0) == 0;
}

bool telemost_origin(const std::string& url) {
  CefURLParts parts{};
  if (!CefParseURL(url, parts)) return false;
  const std::string host = lower_host(CefString(&parts.host).ToString());
  return host == "telemost.yandex.ru" || host == "telemost.360.yandex.ru";
}

void set_diag(const std::string& state, const std::string& detail_json = "{}");

uint64_t bump_isolation_generation(const std::string& url) {
  if (!telemost_origin(url)) return g_isolation_generation.load(std::memory_order_acquire);
  return g_isolation_generation.fetch_add(1, std::memory_order_acq_rel) + 1;
}

void request_isolation(CefRefPtr<CefBrowser> browser, const char* via) {
  if (!browser || g_isolation.empty()) return;
  if (g_runtime_state.load(std::memory_order_acquire) != CefRuntimeState::CEF_READY) return;
  CefRefPtr<CefFrame> frame = browser->GetMainFrame();
  if (!frame) return;
  const std::string url = frame->GetURL().ToString();
  if (!telemost_origin(url)) return;
  uint64_t gen = g_isolation_generation.load(std::memory_order_acquire);
  if (gen == 0) gen = bump_isolation_generation(url);
  if (g_isolation_executed_generation.load(std::memory_order_acquire) == gen) return;
  const int browser_id = browser->GetIdentifier();
  dispatch_async(dispatch_get_main_queue(), ^{
    if (g_isolation_generation.load(std::memory_order_acquire) != gen) return;
    if (g_isolation_executed_generation.load(std::memory_order_acquire) == gen) return;
    if (!g_browser || g_browser->GetIdentifier() != browser_id) return;
    if (g_runtime_state.load(std::memory_order_acquire) != CefRuntimeState::CEF_READY) return;
    CefRefPtr<CefFrame> main = g_browser->GetMainFrame();
    if (!main) return;
    const std::string now = main->GetURL().ToString();
    if (!telemost_origin(now)) return;
    if (g_isolation.empty()) return;
    const std::string script = "window.__o360IsolationNativeGen=" + std::to_string(gen)
        + ";\n" + g_isolation;
    main->ExecuteJavaScript(script, main->GetURL(), 0);
    g_isolation_executed_generation.store(gen, std::memory_order_release);
    std::fprintf(stderr, "[cef-load] ISOLATION_JS gen=%llu via=%s url=%s\n",
                 static_cast<unsigned long long>(gen), via, redact_url(now).c_str());
    std::fflush(stderr);
    set_diag("ISOLATED", std::string("{\"gen\":") + std::to_string(gen)
        + ",\"via\":\"" + via + "\",\"url\":\"" + escape_json(redact_url(now)) + "\"}");
  });
}

void emit(const std::string& type, const std::string& payload = "{}") {
  if (!g_callback) return;
  const std::string json = "{\"type\":\"" + type + "\",\"payload\":" + payload + "}";
  g_callback(json.c_str());
}

void set_diag(const std::string& state, const std::string& detail_json) {
  g_diag_state = state;
  emit("diagnostic", std::string("{\"state\":\"") + state + "\",\"detail\":" + detail_json + "}");
}

void run_on_main(void (^block)(void)) {
  if ([NSThread isMainThread]) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}

void open_system_url(const std::string& url) {
  @autoreleasepool {
    NSString* value = [NSString stringWithUTF8String:url.c_str()];
    if (!value) return;
    NSURL* nsurl = [NSURL URLWithString:value];
    if (nsurl) [[NSWorkspace sharedWorkspace] openURL:nsurl];
  }
}

void open_external_or_block(const std::string& url, const char* caller) {
  set_diag("OPEN_EXTERNAL", std::string("{\"caller\":\"") + caller
      + "\",\"url\":\"" + escape_json(redact_url(url)) + "\"}");
  open_system_url(url);
}

bool is_auth_cookie_name(const std::string& name) {
  return name == "Session_id" || name == "sessionid2" || name == "Session_id2";
}

bool interesting_cookie_host(const std::string& host) {
  const std::string h = lower_host(host);
  return h == "yandex.ru" || h == ".yandex.ru"
      || h == "yandex.com" || h == ".yandex.com"
      || h == "passport.yandex.ru" || h == ".passport.yandex.ru"
      || h == "passport.yandex.com" || h == ".passport.yandex.com"
      || h == "telemost.yandex.ru" || h == ".telemost.yandex.ru"
      || h == "telemost.360.yandex.ru" || h == ".telemost.360.yandex.ru"
      || (h.size() > 10 && h.substr(h.size() - 10) == ".yandex.ru")
      || (h.size() > 11 && h.substr(h.size() - 11) == ".yandex.com");
}

class SessionCookieVisitor final : public CefCookieVisitor {
 public:
  bool Visit(const CefCookie& cookie, int count, int total, bool&) override {
    const std::string domain = CefString(&cookie.domain).ToString();
    const std::string name = CefString(&cookie.name).ToString();
    if (interesting_cookie_host(domain)) {
      entries_.push_back(domain + "\t" + name);
      if (is_auth_cookie_name(name)) authenticated_ = true;
    }
    if (count + 1 >= total) finish();
    return true;
  }

  void finish() {
    if (finished_) return;
    finished_ = true;
    std::string list = "[";
    for (size_t i = 0; i < entries_.size(); ++i) {
      if (i) list += ",";
      const auto tab = entries_[i].find('\t');
      const std::string domain = tab == std::string::npos ? entries_[i] : entries_[i].substr(0, tab);
      const std::string name = tab == std::string::npos ? "" : entries_[i].substr(tab + 1);
      list += "{\"domain\":\"" + escape_json(domain) + "\",\"name\":\"" + escape_json(name) + "\"}";
    }
    list += "]";
    set_diag("SESSION_COOKIES", std::string("{\"authenticated\":") + (authenticated_ ? "true" : "false")
        + ",\"count\":" + std::to_string(entries_.size())
        + ",\"cookies\":" + list + "}");
  }

 private:
  std::vector<std::string> entries_;
  bool authenticated_ = false;
  bool finished_ = false;
  IMPLEMENT_REFCOUNTING(SessionCookieVisitor);
};

bool probe_session_cookies() {
  if (!require_cef_ready("cef_session_cookie_report")) {
    std::fprintf(stderr, "[cef-session] SKIP_NOT_READY\n");
    std::fflush(stderr);
    set_diag("SESSION_COOKIES_NOT_READY", "{\"authenticated\":false,\"count\":0,\"cookies\":[]}");
    return false;
  }
  CefRefPtr<CefCookieManager> manager;
  if (g_context) manager = g_context->GetCookieManager(nullptr);
  if (!manager) manager = CefCookieManager::GetGlobalManager(nullptr);
  if (!manager) {
    set_diag("SESSION_COOKIES", "{\"authenticated\":false,\"count\":0,\"cookies\":[],\"error\":\"no-cookie-manager\"}");
    return true;
  }
  CefRefPtr<SessionCookieVisitor> visitor = new SessionCookieVisitor();
  if (!manager->VisitAllCookies(visitor)) {
    set_diag("SESSION_COOKIES", "{\"authenticated\":false,\"count\":0,\"cookies\":[],\"error\":\"visit-failed\"}");
    return true;
  }
  // Empty store: Visit may never call Visit(); emit empty summary.
  visitor->finish();
  return true;
}

NSView* find_wkwebview(NSView* view) {
  if ([view isKindOfClass:[WKWebView class]]) return view;
  for (NSView* child in view.subviews) {
    if (NSView* found = find_wkwebview(child)) return found;
  }
  return nil;
}

NSRect container_frame() {
  NSView* content = g_window.contentView;
  NSView* webview = content ? find_wkwebview(content) : nil;
  const CGFloat width = std::max(1, g_width);
  const CGFloat height = std::max(1, g_height);
  NSRect css = NSMakeRect(g_x, g_y, width, height);
  if (!webview) {
    const CGFloat parent_height = content ? content.bounds.size.height : height;
    return NSMakeRect(g_x, parent_height - g_y - height, width, height);
  }
  NSRect in_webview = webview.isFlipped ? css : NSMakeRect(g_x, webview.bounds.size.height - g_y - height, width, height);
  return [webview convertRect:in_webview toView:content];
}

void apply_bounds() {
  if (!g_container || !g_has_bounds) return;
  g_container.frame = container_frame();
  for (NSView* child in g_container.subviews) {
    child.frame = g_container.bounds;
    child.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  }
  if (g_browser) {
    g_browser->GetHost()->WasResized();
    g_browser->GetHost()->NotifyScreenInfoChanged();
  }
}

void apply_visibility() {
  if (!g_container) return;
  g_container.hidden = !g_visible || !g_has_bounds;
  if (!g_container.hidden) apply_bounds();
}
}  // namespace

@interface O360CefPump : NSObject
@property(nonatomic, strong) NSTimer* timer;
- (void)schedule:(int64_t)delay_ms;
- (void)invalidateOnMain;
- (void)fire:(NSTimer*)timer;
@end

@implementation O360CefPump
- (void)schedule:(int64_t)delay_ms {
  if (g_shutting_down.load(std::memory_order_acquire)) return;
  const int64_t delay = delay_ms < 0 ? 0 : delay_ms;
  const uint64_t gen = g_pump_generation.fetch_add(1, std::memory_order_acq_rel) + 1;
  char sched[96];
  std::snprintf(sched, sizeof(sched), "delay_ms=%lld generation=%llu",
                static_cast<long long>(delay), static_cast<unsigned long long>(gen));
  pump_log("SCHEDULE", sched);

  void (^apply)(void) = ^{
    if (![NSThread isMainThread]) {
      pump_log("MAIN_THREAD", "no");
      return;
    }
    if (gen != g_pump_generation.load(std::memory_order_acquire)) {
      pump_log("STALE_SCHEDULE_DROP");
      return;
    }
    pump_log("CANCEL_PREVIOUS");
    [self.timer invalidate];
    self.timer = nil;
    if (g_shutting_down.load(std::memory_order_acquire)) return;
    const NSTimeInterval interval = static_cast<NSTimeInterval>(delay) / 1000.0;
    NSTimer* timer = [NSTimer timerWithTimeInterval:interval
                                             target:self
                                           selector:@selector(fire:)
                                           userInfo:@(gen)
                                            repeats:NO];
    [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
    self.timer = timer;
  };

  if ([NSThread isMainThread]) apply();
  else dispatch_async(dispatch_get_main_queue(), apply);
}

- (void)invalidateOnMain {
  if (![NSThread isMainThread]) {
    pump_log("MAIN_THREAD", "no");
    return;
  }
  g_pump_generation.fetch_add(1, std::memory_order_acq_rel);
  pump_log("INVALIDATE");
  [self.timer invalidate];
  self.timer = nil;
}

- (void)fire:(NSTimer*)timer {
  char fire[64];
  uint64_t gen = 0;
  if ([timer.userInfo isKindOfClass:[NSNumber class]]) {
    gen = [timer.userInfo unsignedLongLongValue];
  }
  std::snprintf(fire, sizeof(fire), "generation=%llu", static_cast<unsigned long long>(gen));
  pump_log("FIRE", fire);
  const bool main = [NSThread isMainThread];
  pump_log("MAIN_THREAD", main ? "yes" : "no");
  if (!main) return;
  if (self.timer == timer) self.timer = nil;
  else [timer invalidate];
  if (gen != g_pump_generation.load(std::memory_order_acquire)) {
    pump_log("STALE_TIMER_DROP");
    return;
  }
  const bool initialized = g_pump_ready.load(std::memory_order_acquire);
  const bool shutting = g_shutting_down.load(std::memory_order_acquire);
  const uintptr_t ptr = g_do_work_addr.load(std::memory_order_acquire);
  char state[128];
  std::snprintf(state, sizeof(state), "initialized=%d shutting_down=%d cef_init_ok=%d",
                initialized ? 1 : 0, shutting ? 1 : 0, g_initialized ? 1 : 0);
  pump_log("STATE", state);
  char dw[48];
  std::snprintf(dw, sizeof(dw), "ptr=%p", reinterpret_cast<void*>(ptr));
  pump_log("DO_WORK", dw);
  const bool ready = g_runtime_state.load(std::memory_order_acquire) == CefRuntimeState::CEF_READY;
  if (!initialized || !ready || shutting || ptr == 0) {
    if (ptr == 0) pump_log("FATAL", "do_work=null");
    return;
  }
  CefDoMessageLoopWork();
  // Match CEF's pinned external-pump reference contract: when DoWork does not
  // result in a newer CEF-requested timer, guarantee another bounded tick.
  if (!self.timer && !g_shutting_down.load(std::memory_order_acquire)
      && g_runtime_state.load(std::memory_order_acquire) == CefRuntimeState::CEF_READY) {
    pump_log("FALLBACK_TICK", "delay_ms=33");
    [self schedule:33];
  }
}
@end

namespace {
O360CefPump* g_pump = nil;

class HostApp final : public CefApp, public CefBrowserProcessHandler {
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  void OnBeforeCommandLineProcessing(const CefString&, CefRefPtr<CefCommandLine> command_line) override {
    command_line->AppendSwitch("disable-gpu");
  }
  void OnBeforeChildProcessLaunch(CefRefPtr<CefCommandLine> command_line) override {
    if (!command_line) return;
    const std::string type = command_line->GetSwitchValue("type").ToString();
    const std::string exe = command_line->GetProgram().ToString();
    life("HELPER_LAUNCH", std::string("{\"type\":\"") + escape_json(type)
        + "\",\"program\":\"" + escape_json(exe) + "\",\"via\":\"CefBrowserProcessHandler\"}");
  }
  bool OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine>, const CefString&) override {
    life("CEF_RELAUNCH", "{\"handled\":true}");
    return true;
  }
  void OnScheduleMessagePumpWork(int64_t delay_ms) override {
    if (g_shutting_down.load(std::memory_order_acquire) || !g_pump) return;
    [g_pump schedule:delay_ms];
  }
  IMPLEMENT_REFCOUNTING(HostApp);
};

class Client final : public CefClient, public CefLifeSpanHandler, public CefLoadHandler,
                     public CefRequestHandler, public CefDisplayHandler, public CefPermissionHandler {
 public:
  Client() {
    std::fprintf(stderr, "[cef-client] CREATE ptr=%p\n", this);
    std::fflush(stderr);
  }
  ~Client() override {
    std::fprintf(stderr, "[cef-client] DESTROY ptr=%p\n", this);
    std::fflush(stderr);
  }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }

  bool OnConsoleMessage(CefRefPtr<CefBrowser>, cef_log_severity_t level, const CefString& message,
                        const CefString& source, int line) override {
    const std::string msg = message.ToString();
    const bool interesting = msg.find("Error") != std::string::npos
        || msg.find("error") != std::string::npos
        || msg.find("Uncaught") != std::string::npos
        || msg.find("TypeError") != std::string::npos
        || msg.find("ReferenceError") != std::string::npos;
    if (!interesting && level < LOGSEVERITY_ERROR) return false;
    std::fprintf(stderr, "[cef-console] level=%d line=%d src=%s msg=%s\n",
                 static_cast<int>(level), line, redact_url(source.ToString()).c_str(), msg.c_str());
    std::fflush(stderr);
    return false;
  }

  // Alloy style: return false denies media. Windows uses Chrome style and can
  // defer desktop capture with return false; on macOS Alloy we must Continue().
  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>,
                                      const CefString& requesting_origin, uint32_t requested_permissions,
                                      CefRefPtr<CefMediaAccessCallback> callback) override {
    const std::string origin = requesting_origin.ToString();
    const bool trusted = trusted_url(origin) || telemost_origin(origin);
    if (!callback) return true;
    if (!trusted) {
      callback->Cancel();
      return true;
    }
    constexpr uint32_t kSupported =
        CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE |
        CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE;
    const uint32_t allowed = requested_permissions & kSupported;
    if (allowed == 0 || allowed != requested_permissions) {
      callback->Cancel();
      return true;
    }
    callback->Continue(allowed);
    return true;
  }

  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser>, uint64_t prompt_id, const CefString& requesting_origin,
                              uint32_t requested_permissions,
                              CefRefPtr<CefPermissionPromptCallback> callback) override {
    const std::string origin = requesting_origin.ToString();
    const bool trusted = trusted_url(origin) || telemost_origin(origin);
    constexpr uint32_t kMedia = CEF_PERMISSION_TYPE_CAMERA_STREAM | CEF_PERMISSION_TYPE_MIC_STREAM;
    const bool media_only = (requested_permissions & kMedia) != 0 && (requested_permissions & ~kMedia) == 0;
    (void)prompt_id;
    if (!callback) return true;
    if (!trusted || !media_only) {
      callback->Continue(CEF_PERMISSION_RESULT_DENY);
      return true;
    }
    callback->Continue(CEF_PERMISSION_RESULT_ACCEPT);
    return true;
  }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    life("ON_AFTER_CREATED", "{}");
    g_browser = browser;
    g_close_in_flight = false;
    life("AFTER_CREATED", "{}");
    apply_visibility();
    @autoreleasepool {
      NSView* content = g_window ? g_window.contentView : nil;
      NSView* browser_view = browser ? (__bridge NSView*)browser->GetHost()->GetWindowHandle() : nil;
      const bool container_attached = g_container != nil && g_container.superview != nil;
      const bool browser_parent_ok = browser_view != nil && g_container != nil && browser_view.superview == g_container;
      const NSRect frame = g_container ? g_container.frame : NSZeroRect;
      char detail[768];
      snprintf(detail, sizeof(detail),
               "{\"CEF_CONTAINER_ATTACHED\":%s,\"browserParentOk\":%s,\"hidden\":%s,\"alpha\":%.2f,"
               "\"nativeFrame\":{\"x\":%.1f,\"y\":%.1f,\"w\":%.1f,\"h\":%.1f},"
               "\"requested\":{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d},\"windowOk\":%s,\"contentOk\":%s}",
               container_attached ? "true" : "false",
               browser_parent_ok ? "true" : "false",
               (g_container && g_container.hidden) ? "true" : "false",
               g_container ? g_container.alphaValue : 0.0,
               frame.origin.x, frame.origin.y, frame.size.width, frame.size.height,
               g_x, g_y, g_width, g_height,
               g_window ? "true" : "false",
               content ? "true" : "false");
      set_diag("AFTER_CREATED", detail);
      set_diag("NSVIEW_ATTACHED", std::string("{\"CEF_CONTAINER_ATTACHED\":") + (container_attached ? "true" : "false") + "}");
    }
    emit("ready", "{\"message\":\"Chromium готов\"}");
  }

  bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame>, int, const CefString& target_url,
                     const CefString&, WindowOpenDisposition, bool, const CefPopupFeatures&, CefWindowInfo&,
                     CefRefPtr<CefClient>&, CefBrowserSettings&, CefRefPtr<CefDictionaryValue>&, bool*) override {
    const std::string url = target_url.ToString();
    if (allow_in_cef(url)) {
      set_diag("NAVIGATING", std::string("{\"via\":\"popup\",\"url\":\"") + escape_json(redact_url(url)) + "\"}");
      browser->GetMainFrame()->LoadURL(url);
    } else if (http_url(url)) {
      open_external_or_block(url, "OnBeforePopup");
      emit("blocked-navigation", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\",\"action\":\"system-browser\"}");
    } else {
      emit("blocked-navigation", "{\"url\":\"external-protocol\"}");
    }
    return true;
  }

  void OnBeforeClose(CefRefPtr<CefBrowser>) override {
    life("ON_BEFORE_CLOSE", "{}");
    g_browser = nullptr;
    g_close_in_flight = false;
    life("CEF_BROWSER_EXIT", "{}");
    emit("closed");
    if (!g_pending_url.empty()) {
      const std::string url = g_pending_url;
      const std::string profile = g_pending_profile;
      g_pending_url.clear();
      g_pending_profile.clear();
      dispatch_async(dispatch_get_main_queue(), ^{
        o360_cef_create(url.c_str(), profile.c_str());
      });
    }
  }

  void OnRenderProcessTerminated(CefRefPtr<CefBrowser>, TerminationStatus status, int error_code, const CefString& error_string) override {
    life("CEF_RENDERER_EXIT", std::string("{\"status\":") + std::to_string(static_cast<int>(status))
        + ",\"code\":" + std::to_string(error_code)
        + ",\"message\":\"" + escape_json(error_string.ToString()) + "\"}");
  }

  void OnLoadStart(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, TransitionType) override {
    const std::string url = frame ? frame->GetURL().ToString() : std::string();
    std::fprintf(stderr, "[cef-load] LOAD_START main=%s url=%s\n",
                 frame && frame->IsMain() ? "true" : "false", redact_url(url).c_str());
    std::fflush(stderr);
    if (!frame || !frame->IsMain()) return;
    // SPA / LoadURL often starts with an empty main-frame URL; keep the pending
    // generation from create/reuse so loading=false can still inject.
    uint64_t gen = g_isolation_generation.load(std::memory_order_acquire);
    if (telemost_origin(url)) gen = bump_isolation_generation(url);
    set_diag("LOAD_START", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\",\"gen\":" + std::to_string(gen) + "}");
  }

  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool loading, bool, bool) override {
    const std::string url = browser && browser->GetMainFrame() ? browser->GetMainFrame()->GetURL().ToString() : std::string();
    std::fprintf(stderr, "[cef-load] LOADING_STATE_CHANGE loading=%s url=%s\n",
                 loading ? "true" : "false", redact_url(url).c_str());
    std::fflush(stderr);
    emit("loading", std::string("{\"loading\":") + (loading ? "true" : "false") + "}");
    if (loading) {
      set_diag("NAVIGATING", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\"}");
      return;
    }
    if (telemost_origin(url)) set_diag("TELEMOST_LOADED", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\"}");
    else if (trusted_url(url)) set_diag("LOAD_END", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\"}");
    emit("navigation", std::string("{\"url\":\"") + escape_json(url) + "\"}");
    request_isolation(browser, "loading-false");
  }

  void OnLoadEnd(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int) override {
    if (!frame || !frame->IsMain()) return;
    const std::string url = frame->GetURL().ToString();
    std::fprintf(stderr, "[cef-load] LOAD_END main=true url=%s\n", redact_url(url).c_str());
    std::fflush(stderr);
    set_diag("LOAD_END", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\"}");
    if (trusted_url(url)) probe_session_cookies();
    g_abort_reloaded = false;
    request_isolation(browser, "load-end");
  }

  void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode code, const CefString& text, const CefString& url) override {
    std::fprintf(stderr, "[cef-load] LOAD_ERROR code=%d main=%s url=%s\n",
                 static_cast<int>(code), frame && frame->IsMain() ? "true" : "false",
                 redact_url(url.ToString()).c_str());
    std::fflush(stderr);
    if (frame && !frame->IsMain()) return;
    if (code == ERR_ABORTED) {
      // First CreateBrowser immediately after CefInitialize often aborts the
      // initial main-frame load (CEF external-pump contract). One Reload
      // recovers the initial navigation without recreating the browser.
      if (browser && !g_abort_reloaded) {
        g_abort_reloaded = true;
        std::fprintf(stderr, "[cef-load] ABORT_RELOAD url=%s\n", redact_url(url.ToString()).c_str());
        std::fflush(stderr);
        browser->Reload();
      }
      return;
    }
    set_diag("LOAD_ERROR", std::string("{\"code\":") + std::to_string(code) + ",\"message\":\"" + escape_json(text.ToString()) + "\",\"url\":\"" + escape_json(redact_url(url.ToString())) + "\"}");
    emit("error", std::string("{\"message\":\"") + escape_json(text.ToString()) + "\",\"code\":" + std::to_string(code) + ",\"url\":\"" + escape_json(redact_url(url.ToString())) + "\"}");
  }

  bool OnBeforeBrowse(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, CefRefPtr<CefRequest> request, bool, bool) override {
    const std::string url = request->GetURL().ToString();
    if (allow_in_cef(url)) {
      return false;
    }
    if (http_url(url)) {
      open_external_or_block(url, "OnBeforeBrowse");
      emit("blocked-navigation", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\",\"action\":\"system-browser\"}");
    } else {
      emit("blocked-navigation", "{\"url\":\"external-protocol\"}");
    }
    return true;
  }

  IMPLEMENT_REFCOUNTING(Client);
};

CefRefPtr<Client> g_client;

void destroy_browser_on_main(bool release_context) {
  if (g_browser) {
    g_close_in_flight = true;
    g_abort_reloaded = false;
    g_browser->GetHost()->CloseBrowser(true);
    g_browser = nullptr;
  }
  if (g_container) {
    [g_container removeFromSuperview];
    g_container = nil;
  }
  g_client = nullptr;
  g_isolation_executed_generation.store(0, std::memory_order_release);
  if (release_context) {
    g_context = nullptr;
    g_active_profile.clear();
  }
  g_diag_state = "IDLE";
}

bool ensure_cef_initialized(const std::string& profile) {
  if (g_shutdown_done) {
    life("CEF_INIT_FAIL", "{\"reason\":\"already-shutdown\"}");
    return false;
  }
  if (g_initialized && g_runtime_state.load(std::memory_order_acquire) == CefRuntimeState::CEF_READY) return true;
  if (!g_host_ready || !g_window || g_subprocess.empty() || g_framework.empty() || g_bundle.empty()) {
    life("CEF_INIT_FAIL", "{\"reason\":\"host-not-ready\"}");
    return false;
  }
  [[NSFileManager defaultManager] createDirectoryAtPath:[NSString stringWithUTF8String:profile.c_str()]
                            withIntermediateDirectories:YES attributes:nil error:nil];
  const std::string library = g_framework + "/Chromium Embedded Framework";
  if (!g_library_loaded) {
    set_runtime_state(CefRuntimeState::LOADING_LIBRARY);
    if (!cef_load_library(library.c_str())) {
      set_runtime_state(CefRuntimeState::FAILED);
      set_diag("INIT_FAIL", "{\"reason\":\"cef_load_library\"}");
      return false;
    }
    g_library_loaded = true;
    std::fprintf(stderr, "[cef-runtime] LIBCEF_LOADED\n");
    void* handle = dlopen(library.c_str(), RTLD_NOLOAD | RTLD_LAZY);
    struct RequiredApi { const char* name; void* ptr; };
    RequiredApi required[] = {
      {"cef_initialize", handle ? dlsym(handle, "cef_initialize") : nullptr},
      {"cef_do_message_loop_work", handle ? dlsym(handle, "cef_do_message_loop_work") : nullptr},
      {"cef_cookie_manager_get_global_manager", handle ? dlsym(handle, "cef_cookie_manager_get_global_manager") : nullptr},
      {"cef_request_context_get_global_context", handle ? dlsym(handle, "cef_request_context_get_global_context") : nullptr},
      {"cef_request_context_create_context", handle ? dlsym(handle, "cef_request_context_create_context") : nullptr},
      {"cef_browser_host_create_browser", handle ? dlsym(handle, "cef_browser_host_create_browser") : nullptr},
    };
    bool required_ok = true;
    for (const auto& api : required) {
      std::fprintf(stderr, "[cef-runtime] REQUIRED_API name=%s non_null=%s\n",
                   api.name, api.ptr ? "true" : "false");
      required_ok = required_ok && api.ptr != nullptr;
    }
    std::fflush(stderr);
    void* sym = required[1].ptr;
    g_do_work_addr.store(reinterpret_cast<uintptr_t>(sym), std::memory_order_release);
    pump_log("INIT");
    char ptr_log[80];
    std::snprintf(ptr_log, sizeof(ptr_log), "do_work=%p", sym);
    pump_log("API_PTR", ptr_log);
    if (!required_ok) {
      set_runtime_state(CefRuntimeState::FAILED);
      life("CEF_INIT_FAIL", "{\"reason\":\"required-api-unresolved\"}");
      set_diag("INIT_FAIL", "{\"reason\":\"required-api-unresolved\"}");
      return false;
    }
    set_runtime_state(CefRuntimeState::LIBRARY_LOADED);
  }
  if (!g_pump) g_pump = [O360CefPump new];
  CefMainArgs args(*_NSGetArgc(), *_NSGetArgv());
  CefSettings settings;
  settings.no_sandbox = true;
  settings.external_message_pump = true;
  settings.multi_threaded_message_loop = false;
  settings.log_severity = LOGSEVERITY_WARNING;
  CefString(&settings.root_cache_path).FromString(profile);
  CefString(&settings.browser_subprocess_path).FromString(g_subprocess);
  CefString(&settings.framework_dir_path).FromString(g_framework);
  CefString(&settings.main_bundle_path).FromString(g_bundle);
  CefString(&settings.log_file).FromString(profile + "/cef.log");
  set_runtime_state(CefRuntimeState::CEF_INITIALIZING);
  const bool initialize_ok = CefInitialize(args, settings, new HostApp(), nullptr);
  std::fprintf(stderr, "[cef-runtime] CEF_INITIALIZE_RESULT success=%s\n", initialize_ok ? "true" : "false");
  std::fflush(stderr);
  if (!initialize_ok) {
    set_runtime_state(CefRuntimeState::FAILED);
    life("CEF_INIT_FAIL", "{\"reason\":\"CefInitialize\"}");
    set_diag("INIT_FAIL", "{\"reason\":\"CefInitialize\"}");
    return false;
  }
  g_initialized = true;
  g_pump_ready.store(true, std::memory_order_release);
  set_runtime_state(CefRuntimeState::CEF_READY);
  g_root_cache_path = profile;
  g_init_count += 1;
  life("CEF_INIT_OK", std::string("{\"initCount\":") + std::to_string(g_init_count)
      + ",\"root\":\"" + escape_json(profile) + "\"}");
  set_diag("INIT_OK", "{}");
  emit("initialized");
  return true;
}
}  // namespace

extern "C" int o360_cef_initialize(
    void* parent_nswindow,
    const char* profile_path,
    const char* subprocess_path,
    const char* framework_dir,
    const char* main_bundle_path,
    o360_cef_event_callback callback) {
  if (!parent_nswindow || !profile_path || !subprocess_path || !framework_dir || !main_bundle_path) return 0;
  if (g_shutdown_done) {
    life("CEF_INIT_FAIL", "{\"reason\":\"already-shutdown\"}");
    return 0;
  }
  if (g_host_ready) {
    life("CEF_INIT_SKIP", "{\"reason\":\"already-ready\",\"initCount\":" + std::to_string(g_init_count) + "}");
    return 1;
  }
  g_callback = callback;
  g_init_profile_root = profile_path;
  g_subprocess = subprocess_path;
  g_framework = framework_dir;
  g_bundle = main_bundle_path;
  g_lifecycle_log = g_init_profile_root + "/cef-lifecycle.log";
  life("CEF_INIT_START", std::string("{\"subprocess\":\"") + escape_json(g_subprocess)
      + "\",\"bundle\":\"" + escape_json(g_bundle)
      + "\",\"framework\":\"" + escape_json(g_framework) + "\"}");
  set_diag("INIT_START", "{}");
  static bool exit_hook = false;
  if (!exit_hook) {
    std::atexit(on_process_exit);
    exit_hook = true;
    life("MAIN_START", "{}");
  }
  __block int ok = 0;
  run_on_main(^{
    @autoreleasepool {
      g_window = (__bridge NSWindow*)parent_nswindow;
      if (!g_window) {
        set_diag("INIT_FAIL", "{\"reason\":\"no-nswindow\"}");
        return;
      }
      std::fprintf(stderr, "[cef-runtime] CRAPP_PROTOCOL nsapp_responds_isHandlingSendEvent=%s\n",
                   [NSApp respondsToSelector:@selector(isHandlingSendEvent)] ? "yes" : "no");
      std::fflush(stderr);
      if (!g_pump) g_pump = [O360CefPump new];
      g_host_ready = true;
      ok = 1;
      set_diag("HOST_READY", "{\"deferredCefInitialize\":true,\"cefReady\":false}");
    }
  });
  if (!ok) set_diag("INIT_FAIL", "{\"reason\":\"initialize-returned-0\"}");
  return ok;
}

extern "C" int o360_cef_create(const char* url_utf8, const char* profile_path) {
  std::fprintf(stderr, "[cef-create] ENTER\n");
  std::fflush(stderr);
  if (g_shutdown_done || !g_host_ready || !url_utf8 || !profile_path || !*profile_path) return 0;
  std::string url(url_utf8);
  std::string profile(profile_path);
  __block int ok = 0;
  run_on_main(^{
    @autoreleasepool {
      std::fprintf(stderr, "[cef-create] MAIN_THREAD %s\n", [NSThread isMainThread] ? "yes" : "no");
      std::fprintf(stderr, "[cef-create] STATE %s\n",
                   runtime_state_name(g_runtime_state.load(std::memory_order_acquire)));
      std::fflush(stderr);
      if (!ensure_cef_initialized(profile)) {
        set_diag("CREATE_RETURN", "{\"ok\":false,\"reason\":\"cef-initialize-failed\"}");
        return;
      }
      set_diag("CREATE_START", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\"}");
      [[NSFileManager defaultManager] createDirectoryAtPath:[NSString stringWithUTF8String:profile.c_str()]
                                withIntermediateDirectories:YES attributes:nil error:nil];
      if (g_browser && g_active_profile == profile) {
        set_diag("NAVIGATING", std::string("{\"via\":\"reuse\",\"url\":\"") + escape_json(redact_url(url)) + "\"}");
        bump_isolation_generation(url);
        g_browser->GetMainFrame()->LoadURL(url);
        apply_visibility();
        ok = 1;
        set_diag("CREATE_RETURN", "{\"ok\":true,\"via\":\"reuse\"}");
        return;
      }
      if (g_browser || g_close_in_flight) {
        g_pending_url = url;
        g_pending_profile = profile;
        if (g_browser) destroy_browser_on_main(false);
        ok = 1;
        set_diag("CREATE_RETURN", "{\"ok\":true,\"via\":\"pending-close\"}");
        return;
      }
      NSView* content = g_window ? g_window.contentView : nil;
      if (!content) {
        set_diag("CREATE_RETURN", "{\"ok\":false,\"reason\":\"no-contentView\"}");
        return;
      }
      if (!g_container) {
        g_container = [[NSView alloc] initWithFrame:container_frame()];
        g_container.wantsLayer = YES;
        g_container.clipsToBounds = YES;
        g_container.layer.masksToBounds = YES;
        g_container.layer.backgroundColor = NSColor.blackColor.CGColor;
        g_container.hidden = YES;
        [content addSubview:g_container positioned:NSWindowAbove relativeTo:find_wkwebview(content)];
      } else {
        g_container.frame = container_frame();
      }
      if (!g_context || g_active_profile != profile) {
        if (g_root_cache_path == profile) {
          g_context = CefRequestContext::GetGlobalContext();
        } else {
          CefRequestContextSettings context_settings;
          CefString(&context_settings.cache_path).FromString(profile);
          g_context = CefRequestContext::CreateContext(context_settings, nullptr);
        }
        g_active_profile = profile;
      }
      std::fprintf(stderr, "[cef-create] REQUEST_CONTEXT non_null=%s\n", g_context ? "yes" : "no");
      g_client = new Client();
      std::fprintf(stderr, "[cef-create] CLIENT non_null=%s ptr=%p\n", g_client ? "yes" : "no", g_client.get());
      CefWindowInfo info;
      const int width = std::max(1, g_width);
      const int height = std::max(1, g_height);
      info.SetAsChild((__bridge void*)g_container, CefRect(0, 0, width, height));
      info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
      const bool attached = g_container != nil && g_container.window != nil;
      std::fprintf(stderr,
                   "[cef-create] WINDOW_INFO parent_non_null=%s window_non_null=%s attached_to_window=%s bounds=%dx%d windowless=%s\n",
                   g_container ? "yes" : "no", g_window ? "yes" : "no", attached ? "yes" : "no",
                   width, height, info.windowless_rendering_enabled ? "yes" : "no");
      std::fprintf(stderr, "[cef-create] CEF_UI_THREAD %s\n", CefCurrentlyOn(TID_UI) ? "yes" : "no");
      std::fflush(stderr);
      CefBrowserSettings browser_settings;
      set_diag("NAVIGATING", std::string("{\"via\":\"create\",\"url\":\"") + escape_json(redact_url(url)) + "\"}");
      life("CREATE_BROWSER", std::string("{\"url\":\"") + escape_json(redact_url(url)) + "\"}");
      bump_isolation_generation(url);
      std::fprintf(stderr, "[cef-create] CALL_CREATE_BROWSER\n");
      std::fflush(stderr);
      const bool create_result = CefBrowserHost::CreateBrowser(info, g_client, url, browser_settings, nullptr, g_context);
      std::fprintf(stderr, "[cef-create] CREATE_BROWSER_RETURN result=%s\n", create_result ? "true" : "false");
      std::fflush(stderr);
      if (create_result) {
        apply_visibility();
        emit("create", "{\"ok\":true}");
        ok = 1;
        set_diag("CREATE_RETURN", "{\"ok\":true,\"via\":\"create\"}");
      } else {
        set_diag("LOAD_ERROR", "{\"message\":\"CreateBrowser failed\"}");
        emit("error", "{\"message\":\"CreateBrowser failed\"}");
        ok = 0;
        set_diag("CREATE_RETURN", "{\"ok\":false,\"reason\":\"CreateBrowser failed\"}");
      }
      std::fprintf(stderr, "[cef-create] EXIT result=%d\n", ok);
      std::fflush(stderr);
    }
  });
  return ok;
}

extern "C" void o360_cef_set_bounds(int x, int y, int w, int h) {
  g_x = x;
  g_y = y;
  g_width = std::max(1, w);
  g_height = std::max(1, h);
  g_has_bounds = true;
  char detail[256];
  snprintf(detail, sizeof(detail), "{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}", g_x, g_y, g_width, g_height);
  set_diag("BOUNDS", detail);
  run_on_main(^{ apply_visibility(); });
}

extern "C" void o360_cef_set_visible(int visible) {
  g_visible = visible != 0;
  run_on_main(^{ apply_visibility(); });
}

extern "C" void o360_cef_navigate(const char* url) {
  std::string value = url ? url : "";
  run_on_main(^{
    if (!require_cef_ready("o360_cef_navigate")) return;
    if (g_browser) {
      set_diag("NAVIGATING", std::string("{\"via\":\"navigate\",\"url\":\"") + escape_json(redact_url(value)) + "\"}");
      g_browser->GetMainFrame()->LoadURL(value);
    } else if (!value.empty() && !g_active_profile.empty()) {
      o360_cef_create(value.c_str(), g_active_profile.c_str());
    }
  });
}

extern "C" void o360_cef_back() {}
extern "C" void o360_cef_forward() {}
extern "C" void o360_cef_reload() {
  run_on_main(^{ if (require_cef_ready("o360_cef_reload") && g_browser) g_browser->Reload(); });
}
extern "C" int o360_cef_dom_command(const char*, const char*) { return 0; }
extern "C" void o360_cef_permission_response(uint64_t, int) {}

extern "C" void o360_cef_close_browser() {
  run_on_main(^{
    g_pending_url.clear();
    g_pending_profile.clear();
    destroy_browser_on_main(false);
  });
}

extern "C" int o360_cef_probe_session_cookies() {
  __block int accepted = 0;
  run_on_main(^{ accepted = probe_session_cookies() ? 1 : 0; });
  return accepted;
}

extern "C" void o360_cef_set_isolation_script(const char* js_utf8) {
  g_isolation = js_utf8 ? js_utf8 : "";
}

extern "C" void o360_cef_shutdown() {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_shutdown_done) return;
  if (!g_initialized && !g_host_ready) return;
  g_shutdown_count += 1;
  life("CEF_SHUTDOWN_START", std::string("{\"shutdownCount\":") + std::to_string(g_shutdown_count) + "}");
  run_on_main(^{
    pump_log("SHUTDOWN_BEGIN");
    set_runtime_state(CefRuntimeState::SHUTTING_DOWN);
    g_shutting_down.store(true, std::memory_order_release);
    g_pump_ready.store(false, std::memory_order_release);
    [g_pump invalidateOnMain];
    g_pending_url.clear();
    g_pending_profile.clear();
    destroy_browser_on_main(true);
    g_window = nil;
    g_has_bounds = false;
    g_visible = false;
    g_callback = nullptr;
    g_host_ready = false;
    if (g_initialized) {
      // Final process termination only. Do not re-init CEF in this process after this.
      CefShutdown();
      g_initialized = false;
    }
    [g_pump invalidateOnMain];
    g_pump = nil;
    g_do_work_addr.store(0, std::memory_order_release);
    g_shutdown_done = true;
    life("CEF_SHUTDOWN_OK", "{}");
  });
}
