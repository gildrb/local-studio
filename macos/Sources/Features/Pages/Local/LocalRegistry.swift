import AppKit
import LocalStudioKit
import SwiftUI

struct LocalRegistrySection: View {
    let store: StudioStore
    @State private var filter = ""
    @State private var open: String?
    @State private var inspecting: String?
    @State private var limit = 40

    private var pages: PagesStore { store.pages }
    private var registry: LocalRegistry? { pages.local?.registry }
    private var reachable: [LocalController] { (pages.local?.controllers ?? []).filter { $0.reachable && $0.hasController } }

    var body: some View {
        Section {
            if reachable.count > 1 {
                Picker("Machine", selection: Binding(get: { registry?.controller ?? "" }, set: { load(controller: $0, all: registry?.all ?? false) })) {
                    ForEach(reachable, id: \.target) { controller in
                        Text(controller.name).tag(controller.target)
                    }
                }
            }
            Toggle("All hardware", isOn: Binding(get: { registry?.all ?? false }, set: { load(controller: registry?.controller ?? "", all: $0) }))
                .disabled(pages.isPending(.registry) || reachable.isEmpty)
            VStack(alignment: .leading, spacing: 6) {
                TextField("Filter registry", text: $filter, prompt: Text("Filter models, engines, hardware"))
                    .textFieldStyle(.roundedBorder)
                    .labelsHidden()
                Text(status)
                    .font(.system(size: 11.5))
                    .foregroundStyle(registry?.error == nil ? Theme.secondaryText : Color.red)
                    .lineLimit(2)
            }
            if let registry, models.isEmpty {
                Text(registry.all ? "Nothing matches the filter." : "No registry configurations for this hardware yet. Turn on All hardware to browse everything.")
                    .foregroundStyle(Theme.secondaryText)
            }
            ForEach(models.prefix(limit), id: \.repo) { model in
                DisclosureGroup(isExpanded: Binding(get: { open == model.repo }, set: { open = $0 ? model.repo : nil })) {
                    ForEach(model.variants, id: \.id) { variant in
                        VariantRow(
                            variant: variant, inspecting: inspecting == variant.id,
                            download: downloadState(variant.id)
                        ) {
                            if inspecting == variant.id {
                                inspecting = nil
                            } else {
                                inspecting = variant.id
                                pages.perform(.inspect(controller: registry?.controller ?? "", record: variant.id), pending: .inspect(variant.id))
                            }
                        }
                        if inspecting == variant.id {
                            RecordView(
                                record: pages.local?.record?.id == variant.id ? pages.local?.record : nil,
                                downloading: pages.isPending(.download(variant.id)) || downloadState(variant.id) == "downloading"
                            ) { record in
                                pages.perform(.download(controller: record.controller, record: record.id), pending: .download(record.id))
                            }
                        }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(model.repo)
                                .font(.system(size: 13, weight: .medium))
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            Text(model.variants.count == 1 ? "1 variant" : "\(model.variants.count) variants")
                                .font(.system(size: 11.5))
                                .foregroundStyle(Theme.secondaryText)
                        }
                        Text(summary(model))
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                }
            }
            if models.count > limit {
                Button("Show More (\(models.count - limit) left)") { limit += 40 }
            }
        } header: {
            Text("Registry")
        }
    }

    private var models: [RegistryModel] {
        let query = filter.trimmingCharacters(in: .whitespaces).lowercased()
        let all = registry?.models ?? []
        guard !query.isEmpty else { return all }
        return all.filter { model in
            model.repo.lowercased().contains(query) || model.variants.contains { variant in
                "\(variant.engine) \(variant.hardwareId) \(variant.precision ?? "")".lowercased().contains(query)
            }
        }
    }

    private var status: String {
        guard let registry else {
            if pages.local == nil { return "Waiting for the controller…" }
            return reachable.isEmpty ? "The registry is browsed through a connected machine; none is online." : "Reading the registry…"
        }
        if let error = registry.error { return error }
        let matched = registry.matches.filter { $0.hardwareId != nil }
        let head = matched.isEmpty
            ? "No registry hardware matches \(registry.matches.map(\.name).joined(separator: ", ").nonEmpty ?? "this machine")"
            : "Matched " + matched.map { "\($0.count > 1 ? "\($0.count)× " : "")\($0.hardwareName ?? $0.name)" }.joined(separator: ", ")
        var text = "\(head) · \(models.count) of \(registry.total) models"
        if let commit = registry.commit { text += " · \(commit.prefix(8))" }
        return text
    }

    private func summary(_ model: RegistryModel) -> String {
        var text = model.variants.first.map(VariantRow.summarize) ?? ""
        if let state = downloadState(model.repo) ?? model.variants.lazy.compactMap({ downloadState($0.id) }).first {
            text += " · \(state)"
        }
        return text
    }

    private func downloadState(_ recipe: String) -> String? {
        registry?.downloads.first { $0.recipe == recipe }?.state
    }

    private func load(controller: String, all: Bool) {
        open = nil
        inspecting = nil
        pages.perform(.registry(controller: controller, all: all), pending: .registry)
    }
}

private struct VariantRow: View {
    let variant: RegistryVariant
    let inspecting: Bool
    let download: String?
    let inspect: () -> Void

    static func summarize(_ variant: RegistryVariant) -> String {
        var parts: [String] = [variant.engine]
        if let precision = variant.precision ?? variant.format { parts.append(precision) }
        if let size = variant.sizeGb { parts.append(String(format: "%.1f GB", size)) }
        parts.append("\(variant.hardwareCount > 1 ? "\(variant.hardwareCount)× " : "")\(variant.hardwareId)")
        parts.append(variant.status)
        if variant.recommended { parts.append("recommended") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: variant.fits ? "checkmark.circle" : "circle.dashed")
                .font(.system(size: 12, weight: .light))
                .foregroundStyle(variant.fits ? Color.green : Theme.chromeIcon)
                .help(variant.fits ? "Fits this machine" : "Does not fit this machine")
            Text(Self.summarize(variant))
                .font(.system(size: 12))
                .lineLimit(1)
                .truncationMode(.middle)
            if let download {
                Text(download)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer()
            Button(inspecting ? "Close" : "Inspect", action: inspect)
                .controlSize(.small)
        }
    }
}

private struct RecordView: View {
    let record: LocalRecord?
    let downloading: Bool
    let download: (LocalRecord) -> Void
    @State private var copied = false

    var body: some View {
        if let record {
            VStack(alignment: .leading, spacing: 8) {
                if let command = record.command {
                    Text(command)
                        .font(.system(size: 11.5, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.input, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                HStack(spacing: 8) {
                    Button(copied ? "Copied" : "Use Config") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(record.command ?? "", forType: .string)
                        copied = true
                    }
                    .disabled(record.command == nil)
                    Button(downloading ? "Downloading…" : "Download Weights") { download(record) }
                        .disabled(record.weightsRepo == nil || downloading)
                    if let repo = record.weightsRepo, let url = weightsURL(repo, record.weightsRevision) {
                        Link(weightsLabel(repo, record.weightsRevision), destination: url)
                            .font(.system(size: 12))
                    }
                }
                .controlSize(.small)
                ForEach(sections(record), id: \.0) { label, json in
                    DisclosureGroup(label) {
                        ScrollView(.horizontal) {
                            Text(json)
                                .font(.system(size: 11, design: .monospaced))
                                .textSelection(.enabled)
                                .fixedSize()
                                .padding(.vertical, 4)
                        }
                    }
                    .font(.system(size: 12))
                }
            }
            .padding(.vertical, 4)
        } else {
            Text("Reading the record…")
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
        }
    }

    private func sections(_ record: LocalRecord) -> [(String, String)] {
        [("Recipe", record.recipeJson), ("Model instance", record.modelInstanceJson), ("Model", record.modelJson), ("Hardware", record.hardwareJson)]
            .filter { !$0.1.isEmpty && $0.1 != "null" }
    }

    private func weightsURL(_ repo: String, _ revision: String?) -> URL? {
        URL(string: "https://huggingface.co/\(repo)\(revision.map { "/tree/\($0)" } ?? "")")
    }

    private func weightsLabel(_ repo: String, _ revision: String?) -> String {
        revision.map { "\(repo)@\($0.prefix(8))" } ?? repo
    }
}

struct SharePanel: View {
    let controller: String
    let port: UInt16
    let pages: PagesStore
    let close: () -> Void
    @State private var confirming = false

    private var share: LocalShare? {
        guard let share = pages.local?.share, share.controller == controller, share.port == port else { return nil }
        return share
    }

    private var creating: Bool { pages.isPending(.share(controller, port)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let share {
                if let url = share.pullRequestUrl.flatMap(URL.init(string:)) {
                    Link("Pull request opened", destination: url)
                } else {
                    Text(share.title)
                        .font(.system(size: 13, weight: .medium))
                    Text("\(share.target) · \(share.branch)")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                    if !share.body.isEmpty {
                        Text(share.body)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(6)
                    }
                    ForEach(share.blockers + share.issues, id: \.self) { issue in
                        Label(issue, systemImage: "exclamationmark.triangle")
                            .font(.system(size: 12))
                            .foregroundStyle(.red)
                    }
                    Text(scrubbed(share))
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                    if !share.files.isEmpty {
                        Text(share.files.joined(separator: "\n"))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Theme.secondaryText)
                            .textSelection(.enabled)
                    }
                    if confirming {
                        Text("This will create a PR to \(share.target)")
                            .font(.system(size: 12, weight: .medium))
                    }
                    HStack {
                        Button(confirming ? (creating ? "Creating PR…" : "Create PR") : "Share") {
                            if confirming {
                                pages.perform(.share(controller: controller, port: port), pending: .share(controller, port))
                            } else {
                                confirming = true
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!share.blockers.isEmpty || !share.issues.isEmpty || creating)
                        Button("Decline", action: close)
                            .disabled(creating)
                    }
                    .controlSize(.small)
                }
            } else {
                Text("Preparing registry records. A short validation request is sent to this server.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.hover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func scrubbed(_ share: LocalShare) -> String {
        var text = "Scrubbed: \(share.redactions.joined(separator: ", ").nonEmpty ?? "nothing needed")"
        if !share.reused.isEmpty { text += " · Reuses \(share.reused.joined(separator: ", "))" }
        return text
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
