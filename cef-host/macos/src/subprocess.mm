#include "include/cef_app.h"
#include "include/wrapper/cef_library_loader.h"
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <unistd.h>
#include <chrono>

namespace {
const char* process_type(int argc, char* argv[]) {
  for (int i = 1; i < argc; ++i) {
    if (std::strncmp(argv[i], "--type=", 7) == 0) return argv[i] + 7;
  }
  return "unknown";
}

void life(const char* event, const char* type) {
  using clock = std::chrono::system_clock;
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(clock::now().time_since_epoch()).count();
  std::fprintf(stderr, "[cef-life] ts=%lld event=%s type=%s pid=%d ppid=%d\n",
               static_cast<long long>(ms), event, type, getpid(), getppid());
  std::fflush(stderr);
}

const char* g_type = "unknown";
void on_exit() { life("HELPER_EXIT", g_type); }
}  // namespace

class SubprocessApp final : public CefApp {
  IMPLEMENT_REFCOUNTING(SubprocessApp);
};

int main(int argc, char* argv[]) {
  g_type = process_type(argc, argv);
  life("HELPER_LAUNCH", g_type);
  std::atexit(on_exit);
  CefScopedLibraryLoader loader;
  if (!loader.LoadInHelper()) {
    life("HELPER_LOAD_FAIL", g_type);
    return 1;
  }
  CefMainArgs args(argc, argv);
  return CefExecuteProcess(args, new SubprocessApp(), nullptr);
}
