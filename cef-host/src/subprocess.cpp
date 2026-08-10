#include "include/cef_app.h"
#include <windows.h>

class SubprocessApp final : public CefApp {
  IMPLEMENT_REFCOUNTING(SubprocessApp);
};

int APIENTRY wWinMain(HINSTANCE instance, HINSTANCE, wchar_t*, int) {
  CefMainArgs args(instance);
  return CefExecuteProcess(args, new SubprocessApp(), nullptr);
}
