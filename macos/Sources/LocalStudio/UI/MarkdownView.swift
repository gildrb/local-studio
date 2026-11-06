import SwiftUI

struct MarkdownView: View {
	let document: MarkdownDocView

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			ForEach(Array(document.blocks.enumerated()), id: \.offset) { _, block in
				MarkdownBlockViewRow(block: block)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

struct MarkdownBlockViewRow: View {
	let block: MarkdownBlockView

	var body: some View {
		switch block {
		case .paragraph(let inlines):
			MarkdownInlines(inlines: inlines)
		case .heading(let depth, let inlines):
			MarkdownInlines(inlines: inlines)
				.font(headingFont(depth).weight(.bold))
				.padding(.top, depth <= 2 ? 4 : 0)
		case .list(let ordered, let start, let depth, _, let items):
			VStack(alignment: .leading, spacing: 4) {
				ForEach(Array(items.enumerated()), id: \.offset) { index, item in
					HStack(alignment: .top, spacing: 6) {
						Text(ordered ? "\(start + index). " : "•")
							.font(.body)
							.foregroundStyle(.secondary)
						MarkdownBlocks(blocks: item.blocks)
					}
					.padding(.leading, CGFloat(depth) * 16)
				}
			}
		case .blockquote(_, let blocks):
			MarkdownBlocks(blocks: blocks)
				.padding(.leading, 12)
				.overlay(alignment: .leading) {
					Rectangle()
						.fill(Color.secondary.opacity(0.4))
						.frame(width: 3)
				}
				.foregroundStyle(.secondary)
		case .code(let code):
			MarkdownCodeBlock(code: code)
		case .table(let table):
			MarkdownTable(table: table)
		case .rule:
			Divider()
		}
	}

	private func headingFont(_ depth: Int) -> Font {
		switch depth {
		case 1: return .title
		case 2: return .title2
		case 3: return .title3
		case 4: return .headline
		default: return .subheadline
		}
	}
}

struct MarkdownBlocks: View {
	let blocks: [MarkdownBlockView]

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
				MarkdownBlockViewRow(block: block)
			}
		}
	}
}

struct MarkdownInlines: View {
	let inlines: [MarkdownInlineView]

	var body: some View {
		Text(attributed(inlines))
			.textSelection(.enabled)
	}

	private func attributed(_ inlines: [MarkdownInlineView]) -> AttributedString {
		let raw = plain(inlines)
		if let parsed = try? AttributedString(
			markdown: raw,
			options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
		) {
			return parsed
		}
		return AttributedString(raw)
	}

	private func plain(_ inlines: [MarkdownInlineView]) -> String {
		var result = ""
		for inline in inlines {
			switch inline {
			case .text(let text, let bold, let italic, let strike, let code, _):
				var s = text
				if code {
					s = "`\(s)`"
				}
				if bold {
					s = "**\(s)**"
				}
				if italic {
					s = "*\(s)*"
				}
				if strike {
					s = "~~\(s)~~"
				}
				result += s
			case .lineBreak:
				result += "\n"
			case .fileChip(let label, _, _, _, _, _, _):
				result += "📎 \(label) "
			case .image(let alt, _, _, _, _, _, _, _):
				result += "🖼️ \(alt) "
			case .favicon(let host, _, _):
				result += "🔗 \(host) "
			case .contextReference(_, _, let label, _):
				result += "📌 \(label) "
			case .contextChip(let chip):
				result += "🏷️ \(chip.label) "
			}
		}
		return result
	}
}

struct MarkdownCodeBlock: View {
	let code: MarkdownCodeView

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack {
				if !code.language.isEmpty {
					Text(code.language)
						.font(.caption2)
						.foregroundStyle(.secondary)
				}
				Spacer()
				Button {
					NSPasteboard.general.clearContents()
					NSPasteboard.general.setString(code.code, forType: .string)
				} label: {
					Image(systemName: "doc.on.doc")
						.font(.caption2)
				}
				.buttonStyle(.borderless)
				.foregroundStyle(.secondary)
			}
			Text(code.code)
				.font(.system(.callout, design: .monospaced))
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(10)
		.background(Color(nsColor: .textBackgroundColor).opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
		.overlay(
			RoundedRectangle(cornerRadius: 8)
				.stroke(Color.secondary.opacity(0.2), lineWidth: 1)
		)
	}
}

struct MarkdownTable: View {
	let table: MarkdownTableView

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			// Header
			HStack(spacing: 12) {
				ForEach(Array(table.header.enumerated()), id: \.offset) { _, cell in
					MarkdownInlines(inlines: cell)
						.font(.caption.bold())
						.frame(maxWidth: .infinity, alignment: .leading)
				}
			}
			Divider()
			ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
				HStack(spacing: 12) {
					ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
						MarkdownInlines(inlines: cell)
							.font(.caption)
							.frame(maxWidth: .infinity, alignment: .leading)
					}
				}
			}
		}
		.padding(8)
		.background(Color(nsColor: .windowBackgroundColor).opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
	}
}
