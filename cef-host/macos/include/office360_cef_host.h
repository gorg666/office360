#pragma once
#include <stdint.h>

#define O360_EXPORT __attribute__((visibility("default")))

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*o360_cef_event_callback)(const char* json_utf8);

O360_EXPORT int o360_cef_initialize(
    void* parent_nswindow,
    const char* profile_path,
    const char* subprocess_path,
    const char* framework_dir,
    const char* main_bundle_path,
    o360_cef_event_callback callback);
O360_EXPORT int o360_cef_create(const char* url_utf8, const char* profile_path);
O360_EXPORT void o360_cef_set_bounds(int x, int y, int width, int height);
O360_EXPORT void o360_cef_set_visible(int visible);
O360_EXPORT void o360_cef_navigate(const char* url_utf8);
O360_EXPORT void o360_cef_back(void);
O360_EXPORT void o360_cef_forward(void);
O360_EXPORT void o360_cef_reload(void);
O360_EXPORT int o360_cef_dom_command(const char* request_id, const char* command_json);
O360_EXPORT void o360_cef_permission_response(uint64_t prompt_id, int allow);
O360_EXPORT void o360_cef_close_browser(void);
// Returns 1 when the probe was submitted, or 0 while CEF is not ready.
O360_EXPORT int o360_cef_probe_session_cookies(void);
O360_EXPORT void o360_cef_set_isolation_script(const char* js_utf8);
O360_EXPORT void o360_cef_shutdown(void);

#ifdef __cplusplus
}
#endif
