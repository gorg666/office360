// Office360CEF.app main executable.
// This process is NOT the Chromium browser. Tauri/office360 calls CefInitialize.
// CEF requires a real Mach-O + Info.plist at main_bundle_path (not a shell stub).
// If Chromium accidentally launches this binary, exit immediately.
int main(int argc, char* argv[]) {
  (void)argc;
  (void)argv;
  return 0;
}
