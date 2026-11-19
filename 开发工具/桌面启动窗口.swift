import AppKit
import QuartzCore
import Darwin
import Foundation

@MainActor
final class StartupWindowDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let stateURL: URL
    private let ownerPID: pid_t
    private let logoURL: URL
    private let logURL: URL
    private let shownURL: URL
    private let closedURL: URL
    private var window: NSWindow?
    private var statusLabel: NSTextField?
    private var timer: Timer?
    private var lastPhase = ""
    private var didPresent = false

    init(arguments: [String]) {
        stateURL = URL(fileURLWithPath: arguments[1])
        ownerPID = pid_t(arguments[2]) ?? 0
        logoURL = URL(fileURLWithPath: arguments[3])
        logURL = URL(fileURLWithPath: arguments[4])
        shownURL = URL(fileURLWithPath: arguments[5])
        closedURL = URL(fileURLWithPath: arguments[6])
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        createWindow()
        refreshState()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshState() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        try? Data("closed\n".utf8).write(to: closedURL, options: .atomic)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return true
    }

    private func createWindow() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 204),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.title = "AI-Workbench"
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = true
        window.hasShadow = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.level = .floating
        window.center()

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 204))
        content.wantsLayer = true
        content.layer?.cornerRadius = 8
        content.layer?.masksToBounds = true
        content.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window.contentView = content

        let title = NSTextField(labelWithString: "AI-Workbench")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        title.sizeToFit()
        let titleWidth = ceil(title.frame.width)
        let brandLeft = round((360 - 40 - 12 - titleWidth) / 2)

        let logo = NSImageView(frame: NSRect(x: brandLeft, y: 110, width: 40, height: 40))
        logo.image = NSImage(contentsOf: logoURL)
        logo.imageScaling = .scaleProportionallyUpOrDown
        content.addSubview(logo)

        title.frame = NSRect(x: brandLeft + 52, y: 117, width: titleWidth, height: 28)
        content.addSubview(title)

        let status = NSTextField(labelWithString: "")
        status.font = .systemFont(ofSize: 13, weight: .regular)
        status.textColor = .secondaryLabelColor
        status.alignment = .center
        status.frame = NSRect(x: 24, y: 70, width: 312, height: 22)
        content.addSubview(status)
        statusLabel = status

        let progress = NSProgressIndicator(frame: NSRect(x: 112, y: 44, width: 136, height: 12))
        progress.style = .bar
        progress.controlSize = .small
        progress.isIndeterminate = true
        progress.minValue = 0
        progress.maxValue = 100
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            progress.startAnimation(nil)
        }
        content.addSubview(progress)

        self.window = window
        window.delegate = self
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        didPresent = window.isVisible
        if didPresent {
            try? Data("shown\n".utf8).write(to: shownURL, options: .atomic)
        }
    }

    private func refreshState() {
        guard ownerPID > 0, kill(ownerPID, 0) == 0 else {
            NSApp.terminate(nil)
            return
        }
        guard let data = try? Data(contentsOf: stateURL),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let phase = value["phase"] else {
            NSApp.terminate(nil)
            return
        }
        if phase == "done" {
            NSApp.terminate(nil)
            return
        }
        if phase == "error" {
            showError(value["message"] ?? "启动失败，请查看启动日志。")
            return
        }
        if phase != lastPhase {
            statusLabel?.stringValue = statusText(for: phase)
            lastPhase = phase
        }
    }

    private func statusText(for phase: String) -> String {
        switch phase {
        case "checking": return "正在检查服务"
        case "starting": return "正在启动工作台"
        case "waiting": return "正在准备工作区"
        case "opening": return "正在打开工作区"
        default: return "正在准备工作区"
        }
    }

    private func showError(_ message: String) {
        timer?.invalidate()
        window?.orderOut(nil)
        let alert = NSAlert()
        alert.messageText = "AI-Workbench 启动未完成"
        alert.informativeText = message
        alert.addButton(withTitle: "查看启动日志")
        alert.addButton(withTitle: "关闭")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            NSWorkspace.shared.open(logURL)
        }
        NSApp.terminate(nil)
    }
}

@main
@MainActor
struct StartupWindowApp {
    static func main() {
        guard CommandLine.arguments.count == 7 else { exit(64) }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = StartupWindowDelegate(arguments: CommandLine.arguments)
        app.delegate = delegate
        app.run()
    }
}
