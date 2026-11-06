import Foundation

enum TaggedError: Error {
	case missingKind
	case unknownKind(String)
}

struct StringKey: CodingKey, ExpressibleByStringLiteral {
	var stringValue: String
	var intValue: Int? { nil }
	init(stringValue: String) {
		self.stringValue = stringValue
	}
	init?(intValue: Int) {
		return nil
	}
	init(stringLiteral value: String) {
		self.stringValue = value
	}
}

func stringContainer(_ decoder: Decoder) throws -> KeyedDecodingContainer<StringKey> {
	try decoder.container(keyedBy: StringKey.self)
}

// MARK: - App shell

enum ConnectionPhase: String, Decodable {
	case connecting, ready, reconnecting, failed
}

struct ConnectionView: Decodable, Equatable {
	let phase: ConnectionPhase
	let detail: String?
}

struct ActiveEnvironmentView: Decodable, Equatable {
	let environmentId: String
	let label: String
}

enum AppShellRoute: Decodable, Equatable {
	case home
	case thread(environmentId: String, threadId: String)
	case draft(draftId: String)
	case settings(section: String)
	case usage
	case pullRequests
	case project(projectKey: String)
	case welcome
	case pair
	case connect

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "home": self = .home
		case "thread":
			self = .thread(
				environmentId: try c.decode(String.self, forKey: "environmentId"),
				threadId: try c.decode(String.self, forKey: "threadId")
			)
		case "draft":
			self = .draft(draftId: try c.decode(String.self, forKey: "draftId"))
		case "settings":
			self = .settings(section: try c.decode(String.self, forKey: "section"))
		case "usage": self = .usage
		case "pull-requests": self = .pullRequests
		case "project":
			self = .project(projectKey: try c.decode(String.self, forKey: "projectKey"))
		case "welcome": self = .welcome
		case "pair": self = .pair
		case "connect": self = .connect
		default: throw TaggedError.unknownKind(kind)
		}
	}
}

struct ThreadHeaderProjectView: Decodable, Equatable {
	let name: String
	let icon: ProjectIconView
}

struct AppShellThreadHeaderView: Decodable, Equatable {
	let project: ThreadHeaderProjectView?
	let title: String
}

struct AppShellView: Decodable, Equatable {
	let connection: ConnectionView
	let activeEnvironment: ActiveEnvironmentView?
	let primaryServerVersion: String?
	let route: AppShellRoute
	let threadHeader: AppShellThreadHeaderView?
}

// MARK: - Project icon

enum ProjectIconColor: String, Decodable {
	case gray, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose
}

struct MonogramFallback: Decodable, Equatable {
	let text: String
	let color: ProjectIconColor
}

enum ProjectIconView: Decodable, Equatable {
	case monogram(text: String, color: ProjectIconColor)
	case emoji(emoji: String)
	case lucide(name: String, color: ProjectIconColor)
	case image(url: String, fallback: MonogramFallback?)
	case folder

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "monogram":
			self = .monogram(
				text: try c.decode(String.self, forKey: "text"),
				color: try c.decode(ProjectIconColor.self, forKey: "color")
			)
		case "emoji":
			self = .emoji(emoji: try c.decode(String.self, forKey: "emoji"))
		case "lucide":
			self = .lucide(
				name: try c.decode(String.self, forKey: "name"),
				color: try c.decode(ProjectIconColor.self, forKey: "color")
			)
		case "image":
			self = .image(
				url: try c.decode(String.self, forKey: "url"),
				fallback: try c.decodeIfPresent(MonogramFallback.self, forKey: "fallback")
			)
		case "folder":
			self = .folder
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

// MARK: - Sidebar

struct SidebarSearchView: Decodable, Equatable {
	let placeholder: String
	let query: String
}

struct ScopedProjectView: Decodable, Equatable {
	let projectKey: String
	let displayName: String
	let icon: ProjectIconView
}

struct ProjectScopeView: Decodable, Equatable {
	let label: String
	let scopedProject: ScopedProjectView?
}

struct LabelView: Decodable, Equatable {
	let label: String
}

struct NewThreadView: Decodable, Equatable {
	let label: String
	let tooltip: String
	let inProjectHint: String?
	let disabled: Bool
}

struct SidebarHeaderView: Decodable, Equatable {
	let brandLabel: String
	let stagePill: String?
	let search: SidebarSearchView
	let hasProjects: Bool
	let projectScope: ProjectScopeView
	let addProject: LabelView
	let newThread: NewThreadView
}

enum SidebarSection: String, Decodable {
	case pinned, active, working, snoozed, settled
}

enum Shelf: String, Decodable {
	case working, snoozed, settled
}

enum SidebarThreadStatusKind: String, Decodable {
	case working, monitoring, approval, input, failed, woke, done
}

enum SidebarRowSurface: String, Decodable {
	case active, selected, draft, recede, `default`
}

enum SidebarTitleTone: String, Decodable {
	case foreground
	case foreground95 = "foreground-95"
	case foreground90 = "foreground-90"
	case secondary
	case secondary70 = "secondary-70"
	case muted
}

enum TitleWeight: String, Decodable {
	case normal, medium
}

enum PullRequestGlyphKind: String, Decodable {
	case pullRequest = "pull-request", draft, closed, merged, stack
}

enum PullRequestTone: String, Decodable {
	case open, draft, closed, merged, muted
}

enum RowVariant: String, Decodable {
	case card, slim
}

enum RowAction: String, Decodable {
	case settle, unsettle, unsnooze
}

struct RowProjectView: Decodable, Equatable {
	let displayName: String?
	let icon: ProjectIconView?
	let dimmed: Bool
}

struct RowStatusView: Decodable, Equatable {
	let kind: SidebarThreadStatusKind
	let label: String
	let workingStartedAt: String?
}

struct RowPinView: Decodable, Equatable {
	let canUnpin: Bool
}

struct RowActionsView: Decodable, Equatable {
	let settle: Bool
	let unsettle: Bool
	let unsnooze: Bool
	let snooze: Bool
}

struct RowWorktreeView: Decodable, Equatable {
	let displayPath: String
	let tooltip: String
}

struct RowTerminalView: Decodable, Equatable {
	let count: Int
	let label: String
	let pulse: Bool
}

struct RowPullRequestView: Decodable, Equatable {
	let glyph: PullRequestGlyphKind
	let tone: PullRequestTone
	let text: String
	let label: String
	let opensList: Bool
	let url: String?
}

struct RowProviderView: Decodable, Equatable {
	let driverKind: String
	let displayName: String
	let initials: String
	let accentColor: String?
	let showBadge: Bool
}

struct SidebarThreadRowView: Decodable, Equatable {
	let key: String
	let environmentId: String
	let threadId: String
	let section: SidebarSection
	let variant: RowVariant
	let action: RowAction
	let title: String
	let titleTone: SidebarTitleTone
	let titleWeight: TitleWeight
	let regeneratingTitle: Bool
	let renaming: Bool
	let accessibilityLabel: String
	let isActive: Bool
	let surface: SidebarRowSurface
	let hasUnsentDraft: Bool
	let fadeRow: Bool
	let settledDim: Bool
	let project: RowProjectView
	let status: RowStatusView?
	let timeLabel: String
	let snoozeWakeLabel: String?
	let wokeAt: String?
	let pin: RowPinView?
	let actions: RowActionsView
	let snoozeMenu: SnoozeMenuView?
	let branch: String?
	let worktree: RowWorktreeView?
	let terminal: RowTerminalView?
	let pullRequest: RowPullRequestView?
	let remoteMachine: EnvironmentMachineKind?
	let provider: RowProviderView?
	let jumpLabel: String?
}

enum EnvironmentMachineKind: String, Decodable {
	case server, cloud, linux, desktop, laptop, macMini = "mac-mini", macStudio = "mac-studio"
}

struct DraftRowProjectView: Decodable, Equatable {
	let displayName: String?
	let icon: ProjectIconView?
}

struct SidebarDraftRowView: Decodable, Equatable {
	let key: String
	let draftId: String
	let preview: String
	let accessibilityLabel: String
	let isActive: Bool
	let project: DraftRowProjectView
}

struct SnoozeMenuItemView: Decodable, Equatable {
	let id: String
	let label: String
	let shortcut: String
}

struct SnoozeMenuView: Decodable, Equatable {
	let items: [SnoozeMenuItemView]
	let customLabel: String
}

struct SidebarShelfHeaderView: Decodable, Equatable {
	let shelf: Shelf
	let label: String
	let count: Int
	let expanded: Bool
	let pushToBottom: Bool
}

enum SidebarItemView: Decodable, Equatable {
	case thread(SidebarThreadRowView)
	case draft(SidebarDraftRowView)
	case draftDivider
	case shelfHeader(SidebarShelfHeaderView)
	case showMore(label: String, count: Int)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "thread":
			self = .thread(try c.decode(SidebarThreadRowView.self, forKey: "thread"))
		case "draft":
			self = .draft(try c.decode(SidebarDraftRowView.self, forKey: "draft"))
		case "draft-divider":
			self = .draftDivider
		case "shelf-header":
			self = .shelfHeader(try c.decode(SidebarShelfHeaderView.self, forKey: "shelfHeader"))
		case "show-more":
			self = .showMore(
				label: try c.decode(String.self, forKey: "label"),
				count: try c.decode(Int.self, forKey: "count")
			)
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

enum SidebarEmptyStateView: Decodable, Equatable {
	case noProjects(label: String, actionLabel: String)
	case noThreads(label: String)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "no-projects":
			self = .noProjects(
				label: try c.decode(String.self, forKey: "label"),
				actionLabel: try c.decode(String.self, forKey: "actionLabel")
			)
		case "no-threads":
			self = .noThreads(label: try c.decode(String.self, forKey: "label"))
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

enum FooterItemId: String, Decodable {
	case settings, pullRequests = "pull-requests", usage
}

struct FooterItemView: Decodable, Equatable {
	let id: FooterItemId
	let label: String
}

struct UndoNoticeView: Decodable, Equatable {
	let text: String
	let actionLabel: String
}

struct FooterBackView: Decodable, Equatable {
	let label: String
}

struct SidebarFooterView: Decodable, Equatable {
	let undoNotice: UndoNoticeView?
	let back: FooterBackView?
	let items: [FooterItemView]
}

struct SidebarView: Decodable, Equatable {
	let header: SidebarHeaderView
	let items: [SidebarItemView]
	let emptyState: SidebarEmptyStateView?
	let footer: SidebarFooterView
}

// MARK: - Markdown

enum MarkdownMediaKind: String, Decodable {
	case image, video
}

enum MarkdownImageSource: String, Decodable {
	case direct, workspace, blocked
}

struct PierreIconPaint: Decodable, Equatable {
	let asset: String
	let color: String?
}

struct PierreIconView: Decodable, Equatable {
	let dark: PierreIconPaint
	let light: PierreIconPaint
}

struct MarkdownGalleryView: Decodable, Equatable {
	let linkedUrl: String?
}

enum LinkBrand: String, Decodable {
	case github
}

enum MarkdownInlineView: Decodable, Equatable {
	case text(text: String, bold: Bool, italic: Bool, strike: Bool, code: Bool, href: String?)
	case lineBreak
	case fileChip(label: String, icon: PierreIconView, targetPath: String, displayPath: String, panelPath: String?, line: Int?, copyMarkdown: String)
	case image(alt: String, media: MarkdownMediaKind, source: MarkdownImageSource, path: String?, url: String?, href: String?, originalUrl: String?, gallery: MarkdownGalleryView?)
	case favicon(host: String, brand: LinkBrand?, url: String?)
	case contextReference(contextKind: String, contextId: String, label: String, copyMarkdown: String)
	case contextChip(chip: ContextChipView)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "text":
			self = .text(
				text: try c.decode(String.self, forKey: "text"),
				bold: try c.decodeIfPresent(Bool.self, forKey: "bold") ?? false,
				italic: try c.decodeIfPresent(Bool.self, forKey: "italic") ?? false,
				strike: try c.decodeIfPresent(Bool.self, forKey: "strike") ?? false,
				code: try c.decodeIfPresent(Bool.self, forKey: "code") ?? false,
				href: try c.decodeIfPresent(String.self, forKey: "href")
			)
		case "break":
			self = .lineBreak
		case "file-chip":
			self = .fileChip(
				label: try c.decode(String.self, forKey: "label"),
				icon: try c.decode(PierreIconView.self, forKey: "icon"),
				targetPath: try c.decode(String.self, forKey: "targetPath"),
				displayPath: try c.decode(String.self, forKey: "displayPath"),
				panelPath: try c.decodeIfPresent(String.self, forKey: "panelPath"),
				line: try c.decodeIfPresent(Int.self, forKey: "line"),
				copyMarkdown: try c.decode(String.self, forKey: "copyMarkdown")
			)
		case "image":
			self = .image(
				alt: try c.decode(String.self, forKey: "alt"),
				media: try c.decode(MarkdownMediaKind.self, forKey: "media"),
				source: try c.decode(MarkdownImageSource.self, forKey: "source"),
				path: try c.decodeIfPresent(String.self, forKey: "path"),
				url: try c.decodeIfPresent(String.self, forKey: "url"),
				href: try c.decodeIfPresent(String.self, forKey: "href"),
				originalUrl: try c.decodeIfPresent(String.self, forKey: "originalUrl"),
				gallery: try c.decodeIfPresent(MarkdownGalleryView.self, forKey: "gallery")
			)
		case "favicon":
			self = .favicon(
				host: try c.decode(String.self, forKey: "host"),
				brand: try c.decodeIfPresent(LinkBrand.self, forKey: "brand"),
				url: try c.decodeIfPresent(String.self, forKey: "url")
			)
		case "context-reference":
			self = .contextReference(
				contextKind: try c.decode(String.self, forKey: "contextKind"),
				contextId: try c.decode(String.self, forKey: "contextId"),
				label: try c.decode(String.self, forKey: "label"),
				copyMarkdown: try c.decode(String.self, forKey: "copyMarkdown")
			)
		case "context-chip":
			self = .contextChip(chip: try c.decode(ContextChipView.self, forKey: "chip"))
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct ContextChipView: Decodable, Equatable {
	let label: String
}

struct MarkdownListItemView: Decodable, Equatable {
	let checked: Bool?
	let blocks: [MarkdownBlockView]
}

struct SyntaxTokenView: Decodable, Equatable {
	let text: String
	let dark: String?
	let light: String?
	let fontStyle: Int
}

enum TableAlign: String, Decodable {
	case left, center, right
}

struct MarkdownTableView: Decodable, Equatable {
	let align: [TableAlign?]
	let header: [[MarkdownInlineView]]
	let rows: [[[MarkdownInlineView]]]
	let copyMarkdown: String
	let copyCsv: String
}

struct MarkdownCodeView: Decodable, Equatable {
	let language: String
	let title: String?
	let icon: PierreIconView?
	let code: String
	let canRun: Bool
	let lines: [[SyntaxTokenView]]
	let highlighted: Bool
}

enum MarkdownBlockView: Decodable, Equatable {
	case paragraph(inlines: [MarkdownInlineView])
	case heading(depth: Int, inlines: [MarkdownInlineView])
	case list(ordered: Bool, start: Int, depth: Int, spread: Bool, items: [MarkdownListItemView])
	case blockquote(alert: String?, blocks: [MarkdownBlockView])
	case code(MarkdownCodeView)
	case table(MarkdownTableView)
	case rule

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "paragraph":
			self = .paragraph(inlines: try c.decode([MarkdownInlineView].self, forKey: "inlines"))
		case "heading":
			self = .heading(
				depth: try c.decode(Int.self, forKey: "depth"),
				inlines: try c.decode([MarkdownInlineView].self, forKey: "inlines")
			)
		case "list":
			self = .list(
				ordered: try c.decode(Bool.self, forKey: "ordered"),
				start: try c.decode(Int.self, forKey: "start"),
				depth: try c.decode(Int.self, forKey: "depth"),
				spread: try c.decode(Bool.self, forKey: "spread"),
				items: try c.decode([MarkdownListItemView].self, forKey: "items")
			)
		case "blockquote":
			self = .blockquote(
				alert: try c.decodeIfPresent(String.self, forKey: "alert"),
				blocks: try c.decode([MarkdownBlockView].self, forKey: "blocks")
			)
		case "code":
			self = .code(try c.decode(MarkdownCodeView.self, forKey: "code"))
		case "table":
			self = .table(try c.decode(MarkdownTableView.self, forKey: "table"))
		case "rule":
			self = .rule
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct MarkdownDocView: Decodable, Equatable {
	let blocks: [MarkdownBlockView]
	let wordWrap: Bool
}

// MARK: - Timeline

struct MediaVideoView: Decodable, Equatable {
	let url: String?
	let poster: String?
}

enum TimelineSnapShotAccessibilityView: Decodable, Equatable {
	case text(text: String)
	case json(lines: [[SyntaxTokenView]])
	case unnamed
	case none

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "text": self = .text(text: try c.decode(String.self, forKey: "text"))
		case "json": self = .json(lines: try c.decode([[SyntaxTokenView]].self, forKey: "lines"))
		case "unnamed": self = .unnamed
		case "none": self = .none
		default: throw TaggedError.unknownKind(kind)
		}
	}
}

struct TimelineSnapShotView: Decodable, Equatable {
	let appName: String
	let appInitial: String
	let appIconPath: String?
	let windowTitle: String
	let includesAccessibility: Bool
	let accessibility: TimelineSnapShotAccessibilityView
}

struct TimelineUserGridImageView: Decodable, Equatable {
	let id: String
	let name: String
	let url: String?
	let snapShot: TimelineSnapShotView?
}

struct TimelineUserVideoView: Decodable, Equatable {
	let id: String
	let name: String
	let video: MediaVideoView?
}

struct TimelineUserFileView: Decodable, Equatable {
	let id: String
	let name: String
	let icon: PierreIconView
	let downloadable: Bool
}

enum WorkIconName: String, Decodable {
	case bot, brain, browser, check, circleAlert = "circle-alert", computer, device, eye, globe, hammer, messageCircle = "message-circle", search, squarePen = "square-pen", terminal, pullRequest = "pull-request", t3Code = "t3-code", wrench, x, zap
}

enum WorkIconTone: String, Decodable {
	case warning, destructive, failed, iconMuted = "icon-muted", foreground
}

enum WorkHeadingTone: String, Decodable {
	case warning, destructive, secondaryLabel = "secondary-label", foreground80 = "foreground-80"
}

struct WorkIconView: Decodable, Equatable {
	let name: WorkIconName
	let imageUrl: String?
	let imageUrlDark: String?
}

struct WorkEntryView: Decodable, Equatable {
	let id: String
	let label: String
	let answerPreview: String?
	let answerHighlighted: Bool
	let icon: WorkIconView
	let iconTone: WorkIconTone
	let headingTone: WorkHeadingTone
	let showTrailingFailureMark: Bool
	let canExpand: Bool
	let expanded: Bool
	let expandedBody: String?
	let timeLabel: String
}

struct LiveActivityView: Decodable, Equatable {
	let label: String
	let answerPreview: String?
	let icon: WorkIconView
	let failed: Bool
	let showTrailingFailureMark: Bool
	let shine: Bool
	let shimmer: Bool
}

enum ActivityDetailView: Decodable, Equatable {
	case work(id: String, entries: [WorkEntryView])
	case reasoning(ReasoningTraceView)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "work":
			self = .work(
				id: try c.decode(String.self, forKey: "id"),
				entries: try c.decode([WorkEntryView].self, forKey: "entries")
			)
		case "reasoning":
			self = .reasoning(try c.decode(ReasoningTraceView.self, forKey: "reasoning"))
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct ReasoningTraceView: Decodable, Equatable {
	let id: String
	let messageId: String
	let showHeader: Bool
	let expanded: Bool
	let streaming: Bool
	let headerText: String
	let documents: [MarkdownDocView]
}

struct WorkingView: Decodable, Equatable {
	let label: String
	let compacting: Bool
	let shimmer: Bool
	let timerStartedAt: String?
	let timerText: String?
}

struct WorkToggleRowView: Decodable, Equatable {
	let id: String
	let groupId: String
	let summary: String
	let icon: WorkIconView
	let expanded: Bool
	let hasFailure: Bool
	let timeLabel: String
}

struct WorkRowView: Decodable, Equatable {
	let id: String
	let expandedGroup: Bool
	let entries: [WorkEntryView]
}

struct WorkLiveRowView: Decodable, Equatable {
	let id: String
	let groupId: String
	let expanded: Bool
	let activity: LiveActivityView
}

struct ActivityGroupRowView: Decodable, Equatable {
	let id: String
	let groupId: String
	let expanded: Bool
	let activity: LiveActivityView
	let details: [ActivityDetailView]
}

struct WorkingRowView: Decodable, Equatable {
	let id: String
	let working: WorkingView
}

struct DiffStatView: Decodable, Equatable {
	let additionsText: String
	let deletionsText: String
}

enum FolderIcon: String, Decodable {
	case folderOpen = "folder-open", folderClosed = "folder-closed"
}

enum ChangedFilesNodeView: Decodable, Equatable {
	case directory(key: String, path: String, name: String, indentPx: Double, expanded: Bool, icon: FolderIcon, stat: DiffStatView?, children: [ChangedFilesNodeView])
	case file(key: String, path: String, name: String, indentPx: Double, showLeadingSpacer: Bool, icon: PierreIconView, stat: DiffStatView?)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "directory":
			self = .directory(
				key: try c.decode(String.self, forKey: "key"),
				path: try c.decode(String.self, forKey: "path"),
				name: try c.decode(String.self, forKey: "name"),
				indentPx: try c.decode(Double.self, forKey: "indentPx"),
				expanded: try c.decode(Bool.self, forKey: "expanded"),
				icon: try c.decode(FolderIcon.self, forKey: "icon"),
				stat: try c.decodeIfPresent(DiffStatView.self, forKey: "stat"),
				children: try c.decode([ChangedFilesNodeView].self, forKey: "children")
			)
		case "file":
			self = .file(
				key: try c.decode(String.self, forKey: "key"),
				path: try c.decode(String.self, forKey: "path"),
				name: try c.decode(String.self, forKey: "name"),
				indentPx: try c.decode(Double.self, forKey: "indentPx"),
				showLeadingSpacer: try c.decode(Bool.self, forKey: "showLeadingSpacer"),
				icon: try c.decode(PierreIconView.self, forKey: "icon"),
				stat: try c.decodeIfPresent(DiffStatView.self, forKey: "stat")
			)
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

enum ToggleAllIcon: String, Decodable {
	case chevronsDownUp = "chevrons-down-up", chevronsUpDown = "chevrons-up-down"
}

struct ChangedFilesToggleAllView: Decodable, Equatable {
	let expanded: Bool
	let tooltip: String
	let icon: ToggleAllIcon
}

struct ChangedFilesOpenDiffView: Decodable, Equatable {
	let label: String
	let tooltip: String
	let filePath: String?
}

struct ChangedFilesCardView: Decodable, Equatable {
	let turnId: String
	let countLabel: String
	let stat: DiffStatView?
	let toggleAll: ChangedFilesToggleAllView?
	let openDiff: ChangedFilesOpenDiffView
	let allDirectoriesExpanded: Bool
	let expansionKey: String
	let nodes: [ChangedFilesNodeView]
}

enum TimelineRowView: Decodable, Equatable {
	case user(id: String, messageId: String, text: String, document: MarkdownDocView?, images: [TimelineUserGridImageView], videos: [TimelineUserVideoView], files: [TimelineUserFileView], unknownAttachments: [TimelineUserFileView], collapsible: Bool, expanded: Bool, copyText: String?, revertTurnCount: Int?, revertDisabled: Bool, timeLabel: String, timeTooltip: String)
	case assistant(id: String, document: MarkdownDocView, copyText: String?, streaming: Bool, showMeta: Bool, showCopyButton: Bool, timeLabel: String, timeTooltip: String, changedFiles: ChangedFilesCardView?)
	case assistantMeta(id: String, showCopyButton: Bool, copyText: String?, timeLabel: String, timeTooltip: String)
	case reasoning(id: String, messageId: String, expanded: Bool, document: MarkdownDocView?, timeLabel: String)
	case turnFold(id: String, turnId: String, label: String, expanded: Bool, timeLabel: String, timeTooltip: String)
	case workToggle(WorkToggleRowView)
	case work(WorkRowView)
	case workLive(WorkLiveRowView)
	case activityGroup(ActivityGroupRowView)
	case working(WorkingRowView)
	case thinking(id: String, visible: Bool)
	case contextCompaction(id: String, label: String)
	case proposedPlan(ProposedPlanRowView)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "user":
			self = .user(
				id: try c.decode(String.self, forKey: "id"),
				messageId: try c.decode(String.self, forKey: "messageId"),
				text: try c.decode(String.self, forKey: "text"),
				document: try c.decodeIfPresent(MarkdownDocView.self, forKey: "document"),
				images: try c.decodeIfPresent([TimelineUserGridImageView].self, forKey: "images") ?? [],
				videos: try c.decodeIfPresent([TimelineUserVideoView].self, forKey: "videos") ?? [],
				files: try c.decodeIfPresent([TimelineUserFileView].self, forKey: "files") ?? [],
				unknownAttachments: try c.decodeIfPresent([TimelineUserFileView].self, forKey: "unknownAttachments") ?? [],
				collapsible: try c.decode(Bool.self, forKey: "collapsible"),
				expanded: try c.decode(Bool.self, forKey: "expanded"),
				copyText: try c.decodeIfPresent(String.self, forKey: "copyText"),
				revertTurnCount: try c.decodeIfPresent(Int.self, forKey: "revertTurnCount"),
				revertDisabled: try c.decode(Bool.self, forKey: "revertDisabled"),
				timeLabel: try c.decode(String.self, forKey: "timeLabel"),
				timeTooltip: try c.decode(String.self, forKey: "timeTooltip")
			)
		case "assistant":
			self = .assistant(
				id: try c.decode(String.self, forKey: "id"),
				document: try c.decode(MarkdownDocView.self, forKey: "document"),
				copyText: try c.decodeIfPresent(String.self, forKey: "copyText"),
				streaming: try c.decode(Bool.self, forKey: "streaming"),
				showMeta: try c.decode(Bool.self, forKey: "showMeta"),
				showCopyButton: try c.decode(Bool.self, forKey: "showCopyButton"),
				timeLabel: try c.decode(String.self, forKey: "timeLabel"),
				timeTooltip: try c.decode(String.self, forKey: "timeTooltip"),
				changedFiles: try c.decodeIfPresent(ChangedFilesCardView.self, forKey: "changedFiles")
			)
		case "assistant-meta":
			self = .assistantMeta(
				id: try c.decode(String.self, forKey: "id"),
				showCopyButton: try c.decode(Bool.self, forKey: "showCopyButton"),
				copyText: try c.decodeIfPresent(String.self, forKey: "copyText"),
				timeLabel: try c.decode(String.self, forKey: "timeLabel"),
				timeTooltip: try c.decode(String.self, forKey: "timeTooltip")
			)
		case "reasoning":
			self = .reasoning(
				id: try c.decode(String.self, forKey: "id"),
				messageId: try c.decode(String.self, forKey: "messageId"),
				expanded: try c.decode(Bool.self, forKey: "expanded"),
				document: try c.decodeIfPresent(MarkdownDocView.self, forKey: "document"),
				timeLabel: try c.decode(String.self, forKey: "timeLabel")
			)
		case "turn-fold":
			self = .turnFold(
				id: try c.decode(String.self, forKey: "id"),
				turnId: try c.decode(String.self, forKey: "turnId"),
				label: try c.decode(String.self, forKey: "label"),
				expanded: try c.decode(Bool.self, forKey: "expanded"),
				timeLabel: try c.decode(String.self, forKey: "timeLabel"),
				timeTooltip: try c.decode(String.self, forKey: "timeTooltip")
			)
		case "work-toggle":
			self = .workToggle(try c.decode(WorkToggleRowView.self, forKey: "workToggle"))
		case "work":
			self = .work(try c.decode(WorkRowView.self, forKey: "work"))
		case "work-live":
			self = .workLive(try c.decode(WorkLiveRowView.self, forKey: "workLive"))
		case "activity-group":
			self = .activityGroup(try c.decode(ActivityGroupRowView.self, forKey: "activityGroup"))
		case "working":
			self = .working(try c.decode(WorkingRowView.self, forKey: "working"))
		case "thinking":
			self = .thinking(
				id: try c.decode(String.self, forKey: "id"),
				visible: try c.decode(Bool.self, forKey: "visible")
			)
		case "context-compaction":
			self = .contextCompaction(
				id: try c.decode(String.self, forKey: "id"),
				label: try c.decode(String.self, forKey: "label")
			)
		case "proposed-plan":
			self = .proposedPlan(try c.decode(ProposedPlanRowView.self, forKey: "proposedPlan"))
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct ProposedPlanRowView: Decodable, Equatable {
	let id: String
	let planId: String
	let title: String
	let markdown: String
	let canCollapse: Bool
	let expanded: Bool
	let copyText: String
	let downloadFilename: String
	let canSave: Bool
}

struct TimelineRow: Decodable, Equatable {
	let paddingBottom: Double
	let view: TimelineRowView
}

struct TimelineView: Decodable, Equatable {
	let threadKey: String?
	let loading: Bool
	let scrollRevision: Int
	let rows: [TimelineRow]
}

// MARK: - Composer

struct ComposerModelView: Decodable, Equatable {
	let label: String
	let driverKind: String?
	let initials: String
	let accentColor: String?
	let showInstanceBadge: Bool
}

struct ComposerAccessView: Decodable, Equatable {
	let mode: String
	let label: String
}

struct ComposerAccessOption: Decodable, Equatable {
	let mode: String
	let label: String
	let description: String
}

struct TraitsUnavailableItem: Decodable, Equatable {
	let id: String
	let label: String
	let value: String
}

struct TraitsOption: Decodable, Equatable {
	let id: String
	let label: String
	let isDefault: Bool
	let description: String?
}

struct TraitsSelectSection: Decodable, Equatable {
	let id: String
	let label: String
	let notice: String?
	let selectedValue: String
	let disabled: Bool
	let options: [TraitsOption]
}

struct TraitsBooleanSection: Decodable, Equatable {
	let id: String
	let label: String
	let selectedValue: String
	let options: [TraitsOption]
}

enum TraitsMenuView: Decodable, Equatable {
	case unavailable(items: [TraitsUnavailableItem])
	case controls(selects: [TraitsSelectSection], booleans: [TraitsBooleanSection])

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "unavailable":
			self = .unavailable(items: try c.decode([TraitsUnavailableItem].self, forKey: "items"))
		case "controls":
			self = .controls(
				selects: try c.decode([TraitsSelectSection].self, forKey: "selects"),
				booleans: try c.decode([TraitsBooleanSection].self, forKey: "booleans")
			)
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct ComposerPendingAction: Decodable, Equatable {
	let compact: Bool
	let showPrevious: Bool
	let previousDisabled: Bool
	let label: String
	let disabled: Bool
}

enum ComposerPlanActionKind: String, Decodable {
	case refine, implement
}

struct ComposerPlanAction: Decodable, Equatable {
	let compact: Bool
	let kind: ComposerPlanActionKind
	let label: String
	let disabled: Bool
}

struct ComposerView: Decodable, Equatable {
	let threadKey: String?
	let placeholder: String
	let prompt: String
	let promptRevision: Int
	let threadError: String?
	let providerInputError: String?
	let approvalPending: Bool
	let editorDisabled: Bool
	let pendingAction: ComposerPendingAction?
	let planAction: ComposerPlanAction?
	let hasSendableContent: Bool
	let running: Bool
	let canInterrupt: Bool
	let working: Bool
	let model: ComposerModelView?
	let traits: String?
	let traitsMenu: TraitsMenuView?
	let access: ComposerAccessView
	let accessOptions: [ComposerAccessOption]
}

// MARK: - Toasts

enum CoreToastKind: String, Decodable {
	case error, warning, success, info, loading
}

enum CoreToastActionKey: String, Decodable {
	case action, secondaryAction = "secondary-action"
}

struct CoreToastAction: Decodable, Equatable {
	let key: CoreToastActionKey
	let label: String
}

struct CoreToast: Decodable, Equatable {
	let id: String
	let type: CoreToastKind
	let title: String
	let description: String?
	let actions: [CoreToastAction]
}

struct ToastsView: Decodable, Equatable {
	let toasts: [CoreToast]
}

// MARK: - Model picker

enum ModelPickerRailItem: Decodable, Equatable {
	case favorites(id: String, active: Bool)
	case instance(id: String, driverKind: String, initials: String, accentColor: String?, showInstanceBadge: Bool, active: Bool, disabled: Bool)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "favorites":
			self = .favorites(
				id: try c.decode(String.self, forKey: "id"),
				active: try c.decode(Bool.self, forKey: "active")
			)
		case "instance":
			self = .instance(
				id: try c.decode(String.self, forKey: "id"),
				driverKind: try c.decode(String.self, forKey: "driverKind"),
				initials: try c.decode(String.self, forKey: "initials"),
				accentColor: try c.decodeIfPresent(String.self, forKey: "accentColor"),
				showInstanceBadge: try c.decode(Bool.self, forKey: "showInstanceBadge"),
				active: try c.decode(Bool.self, forKey: "active"),
				disabled: try c.decode(Bool.self, forKey: "disabled")
			)
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct ModelPickerNewBadge: Decodable, Equatable {
	let label: String
}

struct ModelPickerModelRow: Decodable, Equatable {
	let key: String
	let instanceId: String
	let slug: String
	let driverKind: String
	let label: String
	let providerLabel: String
	let selected: Bool
	let favorite: Bool
	let newBadge: ModelPickerNewBadge?
	let unavailableLabel: String?
	let disabledReason: String?
}

enum ModelPickerRow: Decodable, Equatable {
	case model(ModelPickerModelRow)
	case legacySection(key: String, instanceId: String, label: String, countLabel: String, expanded: Bool)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "model":
			self = .model(try c.decode(ModelPickerModelRow.self, forKey: "model"))
		case "legacy-section":
			self = .legacySection(
				key: try c.decode(String.self, forKey: "key"),
				instanceId: try c.decode(String.self, forKey: "instanceId"),
				label: try c.decode(String.self, forKey: "label"),
				countLabel: try c.decode(String.self, forKey: "countLabel"),
				expanded: try c.decode(Bool.self, forKey: "expanded")
			)
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct ModelPickerSetupItem: Decodable, Equatable {
	let instanceId: String
	let message: String
	let actionLabel: String
}

struct ModelPickerView: Decodable, Equatable {
	let showRail: Bool
	let rail: [ModelPickerRailItem]
	let searchPlaceholder: String
	let rows: [ModelPickerRow]
	let emptyStateText: String
	let setupItems: [ModelPickerSetupItem]
}

// MARK: - Header toolbar

struct HeaderToolbarActions: Decodable, Equatable {
	let showProjectScripts: Bool
	let showOpenInPicker: Bool
	let showGitActions: Bool
	let separatorBeforeOpenIn: Bool
	let separatorBeforeGit: Bool
	let overflowTriggerVisible: Bool
	let overflowTriggerAriaLabel: String
}

struct GitQuickAction: Decodable, Equatable {
	let label: String
}

enum GitToolbarView: Decodable, Equatable {
	case hidden
	case gitInit(label: String, disabled: Bool)
	case repo(sourceControlIcon: String, quickAction: GitQuickAction, quickActionIcon: String, quickActionButtonDisabled: Bool, quickActionMenuItemDisabled: Bool, quickActionDisabledReason: String?, menuTriggerDisabled: Bool, submenuLabel: String)

	init(from decoder: Decoder) throws {
		let c = try stringContainer(decoder)
		let kind = try c.decode(String.self, forKey: "kind")
		switch kind {
		case "hidden":
			self = .hidden
		case "init":
			self = .gitInit(
				label: try c.decode(String.self, forKey: "label"),
				disabled: try c.decode(Bool.self, forKey: "disabled")
			)
		case "repo":
			self = .repo(
				sourceControlIcon: try c.decode(String.self, forKey: "sourceControlIcon"),
				quickAction: try c.decode(GitQuickAction.self, forKey: "quickAction"),
				quickActionIcon: try c.decode(String.self, forKey: "quickActionIcon"),
				quickActionButtonDisabled: try c.decode(Bool.self, forKey: "quickActionButtonDisabled"),
				quickActionMenuItemDisabled: try c.decode(Bool.self, forKey: "quickActionMenuItemDisabled"),
				quickActionDisabledReason: try c.decodeIfPresent(String.self, forKey: "quickActionDisabledReason"),
				menuTriggerDisabled: try c.decode(Bool.self, forKey: "menuTriggerDisabled"),
				submenuLabel: try c.decode(String.self, forKey: "submenuLabel")
			)
		default:
			throw TaggedError.unknownKind(kind)
		}
	}
}

struct PanelToggleView: Decodable, Equatable {
	let visible: Bool
	let pressed: Bool
	let disabled: Bool
	let icon: String
	let badgeCount: Int?
}

struct PanelTogglesView: Decodable, Equatable {
	let terminal: PanelToggleView
	let rightPanel: PanelToggleView
}

struct HeaderActionsLayoutView: Decodable, Equatable {
	let collapsed: Bool
	let expanded: Bool
	let fadeMs: Double
	let transitionMs: Double
}

struct HeaderToolbarView: Decodable, Equatable {
	let actions: HeaderToolbarActions
	let layout: HeaderActionsLayoutView
	let git: GitToolbarView
	let panels: PanelTogglesView
}

// MARK: - App theme

enum AppThemeAppearance: String, Decodable {
	case light, dark
}

struct AppThemePaletteView: Decodable, Equatable {
	let themeId: String
	let colors: [String: String]
}

struct AppThemeView: Decodable, Equatable {
	let appearance: AppThemeAppearance
	let palette: AppThemePaletteView?
}
