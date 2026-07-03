cmake_minimum_required(VERSION 3.22)
project(ThalamusApp VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# ── Static linking for self-contained binary ─────────────────────────────────
set(BUILD_SHARED_LIBS OFF)
if(WIN32)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    add_definitions(-DQT_STATICPLUGIN)
endif()

# ── Qt6 modules ─────────────────────────────────────────────────────────────
find_package(Qt6 REQUIRED COMPONENTS
    Core
    Gui
    Widgets
    Network
)

# ── Sources ──────────────────────────────────────────────────────────────────
set(SOURCES
    src/main.cpp
    src/MainWindow.cpp
    src/ConvexClient.cpp
    src/AuthDialog.cpp
    src/ChatView.cpp
    src/ResearchView.cpp
    src/StudyView.cpp
    src/CodeModeView.cpp
    src/VMSandboxView.cpp
    src/VMBridgeManager.cpp
    src/VNCWidget.cpp
    src/MarkdownRenderer.cpp
    src/Settings.cpp
    src/AutoUpdater.cpp
    src/NotificationManager.cpp
    src/OSSelectorDialog.cpp
    src/FileTreeWidget.cpp
)

set(HEADERS
    src/MainWindow.h
    src/ConvexClient.h
    src/AuthDialog.h
    src/ChatView.h
    src/ResearchView.h
    src/StudyView.h
    src/CodeModeView.h
    src/VMSandboxView.h
    src/VMBridgeManager.h
    src/VNCWidget.h
    src/MarkdownRenderer.h
    src/Settings.h
    src/AutoUpdater.h
    src/NotificationManager.h
    src/OSSelectorDialog.h
    src/FileTreeWidget.h
)

set(RESOURCES
    resources/resources.qrc
)

# ── App executable ───────────────────────────────────────────────────────────
add_executable(ThalamusApp WIN32
    ${SOURCES}
    ${HEADERS}
    ${RESOURCES}
)

target_include_directories(ThalamusApp PRIVATE src)

target_link_libraries(ThalamusApp PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Network
)

# ── Windows-specific ─────────────────────────────────────────────────────────
if(WIN32)
    set_target_properties(ThalamusApp PROPERTIES
        WIN32_EXECUTABLE TRUE
        OUTPUT_NAME "Thalamus"
    )

    # Set app icon
    set(APP_ICON "${CMAKE_SOURCE_DIR}/resources/icons/app.ico")
    if(EXISTS ${APP_ICON})
        target_sources(ThalamusApp PRIVATE ${APP_ICON})
        set_target_properties(ThalamusApp PROPERTIES
            LINK_FLAGS "/ENTRY:mainCRTStartup"
        )
    endif()

    # Version info embedded in .exe
    set(VERSION_INFO "${CMAKE_SOURCE_DIR}/resources/version.rc")
    if(EXISTS ${VERSION_INFO})
        target_sources(ThalamusApp PRIVATE ${VERSION_INFO})
    endif()
endif()

# ── Compiler flags ───────────────────────────────────────────────────────────
if(MSVC)
    target_compile_options(ThalamusApp PRIVATE /W4 /utf-8)
else()
    target_compile_options(ThalamusApp PRIVATE -Wall -Wextra -Wpedantic)
endif()

# ── Install rules ────────────────────────────────────────────────────────────
install(TARGETS ThalamusApp RUNTIME DESTINATION bin)
