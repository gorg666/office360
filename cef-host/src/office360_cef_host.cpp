#include "office360_cef_host.h"
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_display_handler.h"
#include "include/cef_life_span_handler.h"
#include "include/cef_load_handler.h"
#include "include/cef_permission_handler.h"
#include "include/cef_parser.h"
#include "include/cef_request_handler.h"
#include "include/cef_request_context.h"
#include "include/cef_task.h"
#include <windows.h>
#include <shellapi.h>
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <functional>
#include <mutex>
#include <sstream>
#include <string>

namespace {
o360_cef_event_callback g_callback = nullptr;
std::mutex g_mutex;
bool g_initialized = false;
HWND g_parent = nullptr;
int g_x = 0, g_y = 0, g_width = 1, g_height = 1;
bool g_has_bounds = false, g_visible = true;

BOOL CALLBACK findWebView(HWND hwnd, LPARAM value) {
  wchar_t className[128]{}; GetClassNameW(hwnd, className, 128);
  if (wcscmp(className, L"WRY_WEBVIEW") == 0) {
    *reinterpret_cast<HWND*>(value) = hwnd; return FALSE;
  }
  return TRUE;
}

class HostApp final : public CefApp {
 public:
  void OnBeforeCommandLineProcessing(const CefString&, CefRefPtr<CefCommandLine> command_line) override {
    command_line->AppendSwitch("disable-gpu");
    command_line->AppendSwitch("disable-video-capture-use-gpu-memory-buffer");
  }
  IMPLEMENT_REFCOUNTING(HostApp);
};

std::string escapeJson(const std::string& value) {
  std::string out; out.reserve(value.size() + 16);
  for (unsigned char c : value) {
    switch (c) { case '\\': out += "\\\\"; break; case '"': out += "\\\""; break; case '\n': out += "\\n"; break; case '\r': out += "\\r"; break; case '\t': out += "\\t"; break; default: if (c >= 0x20) out += static_cast<char>(c); }
  }
  return out;
}
void emit(const std::string& type, const std::string& payload = "{}") {
  if (!g_callback) return;
  const std::string json = "{\"type\":\"" + escapeJson(type) + "\",\"payload\":" + payload + "}";
  g_callback(json.c_str());
}
bool trusted(const std::string& url) {
  CefURLParts parts{};
  if (!CefParseURL(url, parts)) return false;
  const std::string scheme = CefString(&parts.scheme).ToString();
  std::string host = CefString(&parts.host).ToString();
  std::transform(host.begin(), host.end(), host.begin(), [](unsigned char c){ return static_cast<char>(std::tolower(c)); });
  const bool yandex = host == "yandex.ru" || (host.size() > 10 && host.substr(host.size() - 10) == ".yandex.ru");
  const bool ya = host == "ya.ru" || (host.size() > 6 && host.substr(host.size() - 6) == ".ya.ru");
  const bool oauthCallback = scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "::1");
  return (scheme == "https" && (yandex || ya)) || oauthCallback;
}
bool domTrusted(const std::string& url) {
  CefURLParts parts{}; if (!CefParseURL(url, parts)) return false;
  std::string host = CefString(&parts.host).ToString();
  std::transform(host.begin(), host.end(), host.begin(), [](unsigned char c){ return static_cast<char>(std::tolower(c)); });
  return CefString(&parts.scheme).ToString() == "https" && (host == "telemost.yandex.ru" || host == "telemost.360.yandex.ru");
}
bool httpUrl(const std::string& url) {
  CefURLParts parts{}; if (!CefParseURL(url, parts)) return false;
  const auto scheme = CefString(&parts.scheme).ToString(); return scheme == "https" || scheme == "http";
}
std::string safeUrl(const std::string& url) {
  CefURLParts parts{}; if (!CefParseURL(url, parts)) return {};
  std::string result = CefString(&parts.scheme).ToString() + "://" + CefString(&parts.host).ToString();
  const auto path = CefString(&parts.path).ToString(); return result + (path.empty() ? "/" : path);
}

class Client final : public CefClient, public CefLifeSpanHandler, public CefLoadHandler,
                     public CefDisplayHandler, public CefRequestHandler, public CefPermissionHandler {
 public:
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    browser_ = browser;
    auto context = browser_->GetHost()->GetRequestContext();
    for (const auto* origin : {"https://telemost.yandex.ru", "https://telemost.360.yandex.ru"}) {
      context->SetContentSetting(origin, origin, CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_MIC, CEF_CONTENT_SETTING_VALUE_ALLOW);
      context->SetContentSetting(origin, origin, CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_CAMERA, CEF_CONTENT_SETTING_VALUE_ALLOW);
    }
    const HWND hwnd = browser_->GetHost()->GetWindowHandle();
    if (g_has_bounds) SetWindowPos(hwnd, HWND_TOP, g_x, g_y, g_width, g_height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    ShowWindow(hwnd, g_visible ? SW_SHOW : SW_HIDE);
    emit("ready", "{\"message\":\"Chromium готов\"}");
  }
  bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame>, int, const CefString& target_url,
                     const CefString&, CefLifeSpanHandler::WindowOpenDisposition, bool, const CefPopupFeatures&, CefWindowInfo&,
                     CefRefPtr<CefClient>&, CefBrowserSettings&, CefRefPtr<CefDictionaryValue>&, bool*) override {
    const auto url = target_url.ToString();
    if (trusted(url)) browser->GetMainFrame()->LoadURL(url);
    else if (httpUrl(url)) ShellExecuteW(nullptr, L"open", target_url.ToWString().c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    else emit("blocked-navigation", "{\"url\":\"external-protocol\"}");
    return true;
  }
  void OnBeforeClose(CefRefPtr<CefBrowser>) override { browser_ = nullptr; emit("closed"); }
  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool loading, bool canBack, bool canForward) override {
    emit("loading", std::string("{\"loading\":") + (loading ? "true" : "false") + ",\"canBack\":" + (canBack ? "true" : "false") + ",\"canForward\":" + (canForward ? "true" : "false") + "}");
    const auto currentUrl = browser->GetMainFrame()->GetURL();
    if (!loading && safeUrl(currentUrl.ToString()).rfind("https://oauth.yandex.ru/", 0) == 0) {
      browser->GetMainFrame()->ExecuteJavaScript(R"JS((()=>{setTimeout(()=>{const text=document.body?.innerText||'';const error=(text.match(/\b(invalid_scope|invalid_request|access_denied|unauthorized_client)\b/i)||[])[1];if(error)console.log('__O360_OAUTH_ERROR__'+JSON.stringify({error,description:text.slice(0,500)}))},100)})())JS", currentUrl, 0);
    }
    if (!loading && safeUrl(currentUrl.ToString()) == "https://oauth.yandex.ru/verification_code") {
      browser->GetMainFrame()->ExecuteJavaScript(R"JS((()=>{if(window.__o360OAuthCodeProbe)return;let attempts=0;window.__o360OAuthCodeProbe=setInterval(()=>{const visible=el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return el.type!=='hidden'&&el.getAttribute('aria-hidden')!=='true'&&style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0};const elements=[...document.querySelectorAll('[data-testid*=code],code,pre,input')].filter(visible);const values=elements.flatMap(el=>[el.value||'',el.innerText||el.textContent||'']).map(value=>value.trim());let code=values.find(value=>/^[A-Za-z0-9_-]{7,128}$/.test(value));if(!code){const text=document.body?.innerText||'',section=text.split(/Код подтверждения|Confirmation code/i).slice(1).join(' ');code=(section.match(/\b[A-Za-z0-9_-]{7,128}\b/g)||[]).find(value=>/\d/.test(value)&&/[A-Za-z]/.test(value))}if(code){clearInterval(window.__o360OAuthCodeProbe);console.log('__O360_OAUTH__'+JSON.stringify({code}))}else if(++attempts>80)clearInterval(window.__o360OAuthCodeProbe)},250)})())JS", currentUrl, 0);
    }
    if (!loading && domTrusted(browser->GetMainFrame()->GetURL())) {
      browser->GetMainFrame()->ExecuteJavaScript(R"JS((()=>{if(window.__o360BrowserJoin)return;let attempts=0;window.__o360BrowserJoin=setInterval(()=>{const item=[...document.querySelectorAll('button,a')].find(el=>/продолжить в браузере|continue in browser/i.test((el.innerText||el.textContent||'').trim()));if(item){clearInterval(window.__o360BrowserJoin);item.click()}else if(++attempts>120)clearInterval(window.__o360BrowserJoin)},500)})())JS", browser->GetMainFrame()->GetURL(), 0);
      browser->GetMainFrame()->ExecuteJavaScript(R"JS((()=>{
        if(location.pathname!=='/'||window.__o360CompactTelemost)return;
        window.__o360CompactTelemost=true;
        const style=document.createElement('style');style.textContent='.o360-compact-hidden{display:none!important}';document.documentElement.appendChild(style);
        const compact=()=>{const w=innerWidth,h=innerHeight;for(const el of document.querySelectorAll('header,footer,body *')){if(!(el instanceof HTMLElement)||el.classList.contains('o360-compact-hidden'))continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const controls=el.querySelectorAll('a,button').length;const rail=r.left<12&&r.width>=36&&r.width<=110&&r.height>h*.55&&controls>=5;const top=r.top<8&&r.height<=110&&r.width>w*.65&&controls>=1;const bottom=r.bottom>h-8&&r.height<=100&&r.width>w*.55&&controls>=1;if(rail||top||bottom)el.classList.add('o360-compact-hidden')}};
        compact();new MutationObserver(compact).observe(document.body,{childList:true,subtree:true});addEventListener('resize',compact);
      })())JS", browser->GetMainFrame()->GetURL(), 0);
      browser->GetMainFrame()->ExecuteJavaScript(R"JS((()=>{
        if(!/^\/j\/\d+/.test(location.pathname)||window.__o360MeetingFit)return;
        window.__o360MeetingFit=true;
        const fit=()=>{
          const available=Math.max(480,innerHeight);
          const designHeight=1120;
          const factor=Math.min(1,Math.max(.65,available/designHeight));
          document.documentElement.style.zoom=String(factor);
          document.documentElement.style.width=`${100/factor}%`;
          document.documentElement.style.height=`${100/factor}%`;
        };
        fit();addEventListener('resize',fit);
      })())JS", browser->GetMainFrame()->GetURL(), 0);
    }
  }
  void OnLoadError(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, ErrorCode code, const CefString& text, const CefString& url) override {
    emit("error", "{\"message\":\"" + escapeJson(text.ToString()) + "\",\"code\":" + std::to_string(code) + ",\"url\":\"" + escapeJson(url.ToString()) + "\"}");
  }
  void OnAddressChange(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, const CefString& url) override {
    if (frame->IsMain()) emit("navigation", "{\"url\":\"" + escapeJson(safeUrl(url.ToString())) + "\"}");
  }
  bool OnConsoleMessage(CefRefPtr<CefBrowser>, cef_log_severity_t, const CefString& message, const CefString&, int) override {
    const std::string value = message.ToString(), domPrefix = "__O360_DOM__", oauthPrefix = "__O360_OAUTH__", oauthErrorPrefix = "__O360_OAUTH_ERROR__";
    if (value.rfind(domPrefix, 0) == 0) { emit("dom-result", value.substr(domPrefix.size())); return true; }
    if (value.rfind(oauthErrorPrefix, 0) == 0) { emit("oauth-error", value.substr(oauthErrorPrefix.size())); return true; }
    if (value.rfind(oauthPrefix, 0) == 0) { emit("oauth-code", value.substr(oauthPrefix.size())); return true; }
    return false;
  }
  bool OnBeforeBrowse(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, CefRefPtr<CefRequest> request, bool, bool) override {
    const auto url = request->GetURL().ToString();
    if (trusted(url) || url == "about:blank") return false;
    if (httpUrl(url)) { const auto wide = CefString(url).ToWString(); ShellExecuteW(nullptr, L"open", wide.c_str(), nullptr, nullptr, SW_SHOWNORMAL); }
    emit("blocked-navigation", "{\"url\":\"" + escapeJson(safeUrl(url)) + "\"}"); return true;
  }
  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, const CefString& origin, uint32_t permissions, CefRefPtr<CefMediaAccessCallback> callback) override {
    if (!domTrusted(origin.ToString())) { callback->Cancel(); return true; }
    const uint32_t desktop = CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE;
    if ((permissions & desktop) != 0) return false;
    const uint32_t supported = CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE;
    const uint32_t allowed = permissions & supported;
    if (allowed != permissions || allowed == 0) { callback->Cancel(); return true; }
    callback->Continue(allowed);
    return true;
  }
  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser>, uint64_t, const CefString& origin, uint32_t permissions, CefRefPtr<CefPermissionPromptCallback> callback) override {
    const uint32_t media = CEF_PERMISSION_TYPE_CAMERA_STREAM | CEF_PERMISSION_TYPE_MIC_STREAM;
    if (!domTrusted(origin.ToString()) || (permissions & ~media) != 0 || (permissions & media) == 0) {
      callback->Continue(CEF_PERMISSION_RESULT_DENY); return true;
    }
    callback->Continue(CEF_PERMISSION_RESULT_ACCEPT);
    return true;
  }
  void permission(uint64_t, bool) {}
  CefRefPtr<CefBrowser> browser() const { return browser_; }
 private:
  CefRefPtr<CefBrowser> browser_;
  IMPLEMENT_REFCOUNTING(Client);
};
CefRefPtr<Client> g_client;

class FunctionTask final : public CefTask {
 public:
  explicit FunctionTask(std::function<void()> fn) : fn_(std::move(fn)) {}
  void Execute() override { fn_(); }
 private:
  std::function<void()> fn_;
  IMPLEMENT_REFCOUNTING(FunctionTask);
};
void ui(std::function<void()> fn) { CefPostTask(TID_UI, new FunctionTask(std::move(fn))); }
std::string domScript(const std::string& id, const std::string& command) {
  const std::string idJson = "\"" + escapeJson(id) + "\"";
  const std::string commandJson = command.empty() ? "{}" : command;
  return R"JS((function(){const req=)JS" + commandJson + R"JS(;const out={requestId:)JS" + idJson + R"JS(,ok:true};
try{const safe=(el)=>{if(!el)return null;const password=el instanceof HTMLInputElement&&el.type==='password';return{tag:el.tagName.toLowerCase(),id:el.id||'',classes:Array.from(el.classList||[]).slice(0,10),text:(password?'':(el.innerText||el.textContent||'')).trim().slice(0,4000),value:password?'':('value'in el?String(el.value).slice(0,4000):''),attributes:Array.from(el.attributes||[]).filter(a=>/^(role|aria-|data-|name|type|title|placeholder)/.test(a.name)&&!/token|secret|password|auth|session/i.test(a.name)).slice(0,30).reduce((o,a)=>(o[a.name]=a.value.slice(0,1000),o),{})}};
const one=()=>document.querySelector(req.selector);switch(req.type){case'getPageState':out.value={url:location.origin+location.pathname,title:document.title,readyState:document.readyState};break;case'query':case'read':out.value=safe(one());break;case'queryAll':out.value=Array.from(document.querySelectorAll(req.selector)).slice(0,Math.min(req.limit||50,100)).map(safe);break;case'click':one()?.click();out.value=true;break;case'focus':one()?.focus();out.value=true;break;case'scrollIntoView':one()?.scrollIntoView({block:'center'});out.value=true;break;case'input':case'paste':{const el=one();if(!el||el.type==='password')throw Error('Element unavailable');el.focus();el.value=String(req.value||'');el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:req.value||''}));el.dispatchEvent(new Event('change',{bubbles:true}));out.value=true;break}case'snapshot':out.value=Array.from(document.body?.querySelectorAll('*')||[]).slice(0,Math.min(req.limit||500,2000)).map(safe);break;case'inspect':{if(req.enabled){document.addEventListener('click',function pick(e){e.preventDefault();e.stopPropagation();const el=e.target;const selector=el.id?'#'+CSS.escape(el.id):el.tagName.toLowerCase()+Array.from(el.classList).slice(0,3).map(c=>'.'+CSS.escape(c)).join('');console.log('__O360_DOM__'+JSON.stringify({requestId:)JS" + idJson + R"JS(,ok:true,value:{selector,element:safe(el)}}));document.removeEventListener('click',pick,true)},true)}out.value=true;break}default:throw Error('Unsupported DOM command')}}catch(e){out.ok=false;out.error=String(e?.message||e)}console.log('__O360_DOM__'+JSON.stringify(out))})();)JS";
}
}

extern "C" int o360_cef_initialize(void* parent, const wchar_t* profile, const wchar_t* subprocess, o360_cef_event_callback callback) {
  std::lock_guard<std::mutex> lock(g_mutex); if (g_initialized) return 1; g_callback = callback;
  std::filesystem::create_directories(profile);
  CefMainArgs args(GetModuleHandle(nullptr)); CefSettings settings; settings.no_sandbox = true; settings.multi_threaded_message_loop = true;
  CefString(&settings.root_cache_path) = profile; CefString(&settings.cache_path) = profile; CefString(&settings.browser_subprocess_path) = subprocess;
  const auto runtime = std::filesystem::path(subprocess).parent_path();
  CefString(&settings.resources_dir_path) = runtime.wstring(); CefString(&settings.locales_dir_path) = (runtime / L"locales").wstring();
  settings.log_severity = LOGSEVERITY_WARNING; CefString(&settings.log_file) = (std::filesystem::path(profile) / L"cef.log").wstring();
  g_initialized = CefInitialize(args, settings, new HostApp(), nullptr); if (!g_initialized) return 0;
  g_parent = static_cast<HWND>(parent);
  HWND webview = nullptr; EnumChildWindows(g_parent, findWebView, reinterpret_cast<LPARAM>(&webview));
  if (webview) g_parent = webview;
  emit("initialized"); return 1;
}
extern "C" int o360_cef_create(const char* url) {
  if (!g_initialized || !g_parent) return 0;
  g_client = new Client(); CefWindowInfo info; RECT rect{}; GetClientRect(g_parent, &rect); info.SetAsChild(g_parent, CefRect(0, 0, rect.right, rect.bottom));
  info.runtime_style = CEF_RUNTIME_STYLE_CHROME;
  CefBrowserSettings settings; return CefBrowserHost::CreateBrowser(info, g_client, url, settings, nullptr, nullptr) ? 1 : 0;
}
extern "C" void o360_cef_set_bounds(int x,int y,int w,int h){g_x=x;g_y=y;g_width=std::max(1,w);g_height=std::max(1,h);g_has_bounds=true;ui([]{if(g_client&&g_client->browser())SetWindowPos(g_client->browser()->GetHost()->GetWindowHandle(),HWND_TOP,g_x,g_y,g_width,g_height,SWP_NOACTIVATE|SWP_SHOWWINDOW);});}
extern "C" void o360_cef_set_visible(int v){g_visible=v!=0;ui([]{if(g_client&&g_client->browser())ShowWindow(g_client->browser()->GetHost()->GetWindowHandle(),g_visible?SW_SHOW:SW_HIDE);});}
extern "C" void o360_cef_navigate(const char* url){std::string s=url?url:"";ui([s]{if(g_client&&g_client->browser()&&trusted(s))g_client->browser()->GetMainFrame()->LoadURL(s);});}
extern "C" void o360_cef_back(){ui([]{if(g_client&&g_client->browser())g_client->browser()->GoBack();});}
extern "C" void o360_cef_forward(){ui([]{if(g_client&&g_client->browser())g_client->browser()->GoForward();});}
extern "C" void o360_cef_reload(){ui([]{if(g_client&&g_client->browser())g_client->browser()->Reload();});}
extern "C" int o360_cef_dom_command(const char* id,const char* command){if(!g_client||!g_client->browser()||!domTrusted(g_client->browser()->GetMainFrame()->GetURL()))return 0;std::string script=domScript(id?id:"",command?command:"{}");ui([script]{if(g_client&&g_client->browser()&&domTrusted(g_client->browser()->GetMainFrame()->GetURL()))g_client->browser()->GetMainFrame()->ExecuteJavaScript(script,g_client->browser()->GetMainFrame()->GetURL(),0);});return 1;}
extern "C" void o360_cef_permission_response(uint64_t id,int allow){ui([=]{if(g_client)g_client->permission(id,allow!=0);});}
extern "C" void o360_cef_shutdown(){std::lock_guard<std::mutex> lock(g_mutex);if(!g_initialized)return;if(g_client&&g_client->browser())g_client->browser()->GetHost()->CloseBrowser(true);g_client=nullptr;CefShutdown();g_initialized=false;g_parent=nullptr;g_has_bounds=false;g_callback=nullptr;}
