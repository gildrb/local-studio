import AppKit
import LocalStudioKit
import SwiftUI

struct DeviceSurfaceView: View {
    let model: DeviceModel
    let notice: StudioNotice?

    var body: some View {
        VStack(spacing: 0) {
            PanelToolbar {
                Text("Devices")
                    .font(.system(size: 12.5, weight: .medium))
                if model.phase == .loaded, !model.devices.isEmpty {
                    let booted = model.devices.filter { $0.state == "Booted" }.count
                    Text(booted > 0 ? "\(booted) running" : "\(model.devices.count) available")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .monospacedDigit()
                }
                Spacer()
                PanelIconButton("Refresh Devices", symbol: "arrow.clockwise") { model.load() }
            }
            if let status = model.status {
                HStack(spacing: 6) {
                    Image(systemName: model.actionFailed ? "exclamationmark.triangle" : "checkmark.circle")
                        .font(.system(size: 11, weight: .light))
                        .foregroundStyle(model.actionFailed ? Theme.diffRemoved : Theme.secondaryText)
                        .accessibilityHidden(true)
                    Text(status)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(2)
                        .textSelection(.enabled)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Theme.card)
                .accessibilityElement(children: .combine)
                PanelHairline()
            }
            content
        }
        .onChange(of: notice) { _, notice in
            guard let notice, notice.level == .info, model.devices.isEmpty else { return }
            if case .failed = model.phase { return }
            model.reason = notice.text
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle:
            PanelMessage.loading("Looking for devices…")
        case .loading where model.devices.isEmpty:
            PanelMessage.loading("Looking for devices…")
        case .failed(let message) where model.devices.isEmpty:
            PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t list devices.", detail: message, actionTitle: "Try Again") { model.load() }
        default:
            if model.devices.isEmpty {
                PanelMessage(
                    symbol: "iphone",
                    title: "No simulators or emulators found.",
                    detail: model.reason ?? "Install Xcode for iOS Simulators, or the Android SDK for emulators.",
                    actionTitle: "Refresh"
                ) { model.load() }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2, pinnedViews: [.sectionHeaders]) {
                        section("iOS Simulators", model.simulators)
                        section("Android", model.android)
                    }
                    .padding(.horizontal, 6)
                    .padding(.bottom, 8)
                }
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ devices: [Device]) -> some View {
        if !devices.isEmpty {
            Section {
                ForEach(devices, id: \.id) { device in
                    DeviceRow(device: device, busy: model.busy.contains(device.id)) {
                        model.boot(device)
                    } shutDown: {
                        model.shutDown(device)
                    }
                }
            } header: {
                Text(title)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 10)
                    .padding(.top, 10)
                    .padding(.bottom, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.canvas)
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }
}

private struct DeviceRow: View {
    let device: Device
    let busy: Bool
    let boot: () -> Void
    let shutDown: () -> Void
    @State private var hovering = false

    var body: some View {
        let booted = device.state == "Booted"
        HStack(spacing: 10) {
            Image(systemName: device.platform == .iosSimulator ? "iphone" : "candybarphone")
                .font(.system(size: 15, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(device.name)
                    .font(.system(size: 13))
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle()
                        .fill(booted ? Theme.diffAdded : Theme.secondaryText.opacity(0.5))
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                    Text(meta)
                        .lineLimit(1)
                }
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
            }
            Spacer(minLength: 8)
            action(booted: booted)
        }
        .padding(.horizontal, 10)
        .frame(height: 46)
        .rowSurface(selected: false, hovering: hovering)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(device.name)
        .contextMenu {
            Button("Copy Device ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(device.id, forType: .string)
            }
        }
    }

    private var meta: String {
        var parts = [stateLabel]
        if let runtime = device.runtime, !runtime.isEmpty {
            parts.append(runtime)
        }
        if device.platform == .androidDevice {
            parts.append("Physical device")
        }
        return parts.joined(separator: " · ")
    }

    private var stateLabel: String {
        switch device.state {
        case "Booted": device.platform == .iosSimulator ? "Booted" : "Running"
        case "Shutdown": "Shut down"
        default: device.state
        }
    }

    @ViewBuilder
    private func action(booted: Bool) -> some View {
        if busy {
            Text(booted ? "Stopping…" : "Starting…")
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
        } else if booted {
            if device.platform != .androidDevice {
                Button("Shut Down", action: shutDown)
                    .controlSize(.small)
                    .accessibilityLabel("Shut Down \(device.name)")
            }
        } else if device.state == "Shutdown" {
            Button("Boot", action: boot)
                .controlSize(.small)
                .accessibilityLabel("Boot \(device.name)")
        }
    }
}
