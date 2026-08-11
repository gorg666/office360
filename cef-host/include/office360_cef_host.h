#pragma once
#include <stdint.h>

#ifdef O360_CEF_EXPORTS
#define O360_API __declspec(dllexport)
#else
#define O360_API __declspec(dllimport)
#endif

extern "C" {
typedef void(__stdcall* o360_cef_event_callback)(const char* json_utf8);
O360_API int o360_cef_initialize(void* parent_hwnd, const wchar_t* profile_path, const wchar_t* subprocess_path, o360_cef_event_callback callback);
O360_API int o360_cef_create(const char* url_utf8);
O360_API void o360_cef_set_bounds(int x, int y, int width, int height);
O360_API void o360_cef_set_visible(int visible);
O360_API void o360_cef_navigate(const char* url_utf8);
O360_API void o360_cef_back();
O360_API void o360_cef_forward();
O360_API void o360_cef_reload();
O360_API void o360_cef_clear_session(const char* next_url);
O360_API int o360_cef_dom_command(const char* request_id, const char* command_json);
O360_API void o360_cef_permission_response(uint64_t prompt_id, int allow);
O360_API void o360_cef_shutdown();
}
