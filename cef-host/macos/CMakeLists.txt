cmake_minimum_required(VERSION 3.24)
project(office360_cef_macos LANGUAGES C CXX OBJCXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_STANDARD 20)
set(O360_CEF_ARCH "x86_64" CACHE STRING "Office360 CEF target architecture")
if(NOT O360_CEF_ARCH STREQUAL "x86_64" AND NOT O360_CEF_ARCH STREQUAL "arm64")
  message(FATAL_ERROR "O360_CEF_ARCH must be x86_64 or arm64")
endif()
set(CMAKE_OSX_ARCHITECTURES "${O360_CEF_ARCH}" CACHE STRING "" FORCE)
# CEF derives PROJECT_ARCH from the build host by default; set it explicitly
# so cross-building arm64 on an Intel release machine selects arm64 flags.
set(PROJECT_ARCH "${O360_CEF_ARCH}" CACHE STRING "CEF target architecture" FORCE)
set(USE_SANDBOX OFF CACHE BOOL "" FORCE)

if(NOT CEF_ROOT OR NOT EXISTS "${CEF_ROOT}/cmake/FindCEF.cmake")
  message(FATAL_ERROR "Set CEF_ROOT to the pinned CEF macOS binary distribution")
endif()

list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

set(O360_MAC_SRC "${CMAKE_CURRENT_SOURCE_DIR}")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out")

add_library(office360_cef_host SHARED src/office360_cef_host.mm)
target_include_directories(office360_cef_host PRIVATE "${CEF_INCLUDE_PATH}" "${O360_MAC_SRC}/include")
target_link_libraries(office360_cef_host PRIVATE libcef_dll_wrapper ${CEF_STANDARD_LIBS} "-framework WebKit")
target_compile_options(office360_cef_host PRIVATE -fobjc-arc -fno-rtti -fno-exceptions -fvisibility=default)
set_target_properties(office360_cef_host PROPERTIES
  OUTPUT_NAME "office360_cef_host"
  PREFIX "lib"
  C_VISIBILITY_PRESET default
  CXX_VISIBILITY_PRESET default
)

# Real Mach-O main for Office360CEF.app (CEF main_bundle_path). Never a shell stub.
add_executable(office360_cef_main MACOSX_BUNDLE src/main_bundle.mm)
set_target_properties(office360_cef_main PROPERTIES
  OUTPUT_NAME "Office360CEF"
  MACOSX_BUNDLE_INFO_PLIST "${O360_MAC_SRC}/app-Info.plist.in"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out"
)

set(CEF_HELPER_OUTPUT_NAME "Office360CEF Helper")
set(CEF_HELPER_TARGET "office360_cef_helper")
foreach(_suffix_list ${CEF_HELPER_APP_SUFFIXES})
  string(REPLACE ":" ";" _suffix_list "${_suffix_list}")
  list(GET _suffix_list 0 _name_suffix)
  list(GET _suffix_list 1 _target_suffix)
  list(GET _suffix_list 2 _plist_suffix)
  set(_helper_target "${CEF_HELPER_TARGET}${_target_suffix}")
  set(_helper_output_name "${CEF_HELPER_OUTPUT_NAME}${_name_suffix}")
  set(_helper_info_plist "${CMAKE_CURRENT_BINARY_DIR}/helper-Info${_target_suffix}.plist")
  file(READ "${O360_MAC_SRC}/helper-Info.plist.in" _plist_contents)
  string(REPLACE "\${EXECUTABLE_NAME}" "${_helper_output_name}" _plist_contents "${_plist_contents}")
  string(REPLACE "\${PRODUCT_NAME}" "${_helper_output_name}" _plist_contents "${_plist_contents}")
  string(REPLACE "\${BUNDLE_ID_SUFFIX}" "${_plist_suffix}" _plist_contents "${_plist_contents}")
  string(REPLACE "\${VERSION_SHORT}" "0.4.21" _plist_contents "${_plist_contents}")
  file(WRITE "${_helper_info_plist}" "${_plist_contents}")
  add_executable(${_helper_target} MACOSX_BUNDLE src/subprocess.mm)
  target_include_directories(${_helper_target} PRIVATE "${CEF_INCLUDE_PATH}")
  target_link_libraries(${_helper_target} PRIVATE libcef_dll_wrapper ${CEF_STANDARD_LIBS})
  target_compile_options(${_helper_target} PRIVATE -fobjc-arc -fno-rtti -fno-exceptions)
  set_target_properties(${_helper_target} PROPERTIES
    MACOSX_BUNDLE_INFO_PLIST "${_helper_info_plist}"
    OUTPUT_NAME "${_helper_output_name}"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out"
  )
endforeach()
