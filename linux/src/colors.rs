use std::cell::RefCell;
use std::fmt::Write;

pub const GILDRB: &str = "gildrb";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Syntax {
    pub default: &'static str,
    pub keyword: &'static str,
    pub operator: &'static str,
    pub string: &'static str,
    pub function: &'static str,
    pub types: &'static str,
    pub property: &'static str,
    pub constant: &'static str,
    pub number: &'static str,
    pub parameter: &'static str,
    pub builtin: &'static str,
    pub comment: &'static str,
    pub punctuation: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Colors {
    pub dark: bool,
    pub canvas: &'static str,
    pub sidebar: &'static str,
    pub card: &'static str,
    pub raised: &'static str,
    pub key: &'static str,
    pub text: &'static str,
    pub secondary: &'static str,
    pub muted: &'static str,
    pub hairline: &'static str,
    pub accent: &'static str,
    pub on_accent: &'static str,
    pub ok: &'static str,
    pub warn: &'static str,
    pub error: &'static str,
    pub info: &'static str,
    pub added: &'static str,
    pub removed: &'static str,
    pub added_bg: &'static str,
    pub removed_bg: &'static str,
    pub code_bg: &'static str,
    pub terminal_bg: &'static str,
    pub terminal_fg: &'static str,
    pub cursor: &'static str,
    pub selection: &'static str,
    pub syntax: Syntax,
    pub ansi: [&'static str; 16],
}

pub const GILDRB_DARK: Colors = Colors {
    dark: true,
    canvas: "#110b07",
    sidebar: "#17100b",
    card: "#1e1711",
    raised: "#251d17",
    key: "#2d251d",
    text: "#f5eee0",
    secondary: "#c6b4a0",
    muted: "#a8907b",
    hairline: "alpha(#a8907b, 0.16)",
    accent: "#d4af5d",
    on_accent: "#110b07",
    ok: "#8ec184",
    warn: "#eba474",
    error: "#f69c8e",
    info: "#c6b4a0",
    added: "#8ec184",
    removed: "#f69c8e",
    added_bg: "#131f10",
    removed_bg: "#2a1512",
    code_bg: "#1e1711",
    terminal_bg: "#17100b",
    terminal_fg: "#e0d6c6",
    cursor: "#d4af5d",
    selection: "#2b241f",
    syntax: Syntax {
        default: "#e0d6c6",
        keyword: "#d4af5d",
        operator: "#d4af5d",
        string: "#8ec184",
        function: "#79c1b2",
        types: "#c6b4a0",
        property: "#c6b4a0",
        constant: "#c6b4a0",
        number: "#eba474",
        parameter: "#eba474",
        builtin: "#c6b4a0",
        comment: "#a9a098",
        punctuation: "#c6c1bb",
    },
    ansi: [
        "#110b07", "#f69c8e", "#8ec184", "#eba474", "#c6b4a0", "#eca281", "#79c1b2", "#e0d6c6", "#a9a098", "#ffb7ab",
        "#abd3a2", "#f7bd96", "#d6c7b4", "#fbbb9e", "#9cd4c8", "#f5eee0",
    ],
};

pub const GILDRB_LIGHT: Colors = Colors {
    dark: false,
    canvas: "#fffdfa",
    sidebar: "#fcf6ec",
    card: "#fcf6eb",
    raised: "#fefbf6",
    key: "#fefbf6",
    text: "#1f1611",
    secondary: "#58463b",
    muted: "#735e4f",
    hairline: "alpha(#735e4f, 0.18)",
    accent: "#896706",
    on_accent: "#fffdfa",
    ok: "#48783f",
    warn: "#9c5b2b",
    error: "#a55348",
    info: "#7a6a58",
    added: "#48783f",
    removed: "#a55348",
    added_bg: "#e6f6e3",
    removed_bg: "#ffe9e5",
    code_bg: "#f5eee1",
    terminal_bg: "#fcf6ec",
    terminal_fg: "#1f1611",
    cursor: "#896706",
    selection: "#ecdfca",
    syntax: Syntax {
        default: "#1f1611",
        keyword: "#1f1611",
        operator: "#735e4f",
        string: "#58463b",
        function: "#1f1611",
        types: "#1f1611",
        property: "#1f1611",
        constant: "#58463b",
        number: "#58463b",
        parameter: "#58463b",
        builtin: "#1f1611",
        comment: "#735e4f",
        punctuation: "#735e4f",
    },
    ansi: [
        "#1f1611", "#a55348", "#48783f", "#9c5b2b", "#7a6a58", "#9e5b3c", "#2f786b", "#58463b", "#735e4f", "#a55348",
        "#48783f", "#9c5b2b", "#7a6a58", "#9e5b3c", "#2f786b", "#1f1611",
    ],
};

pub const DEFAULT_DARK: Colors = Colors {
    dark: true,
    canvas: "#0a0a0a",
    sidebar: "#111111",
    card: "#111111",
    raised: "#161616",
    key: "#1c1c1e",
    text: "#ececec",
    secondary: "#c9d1d9",
    muted: "#8b949e",
    hairline: "alpha(white, 0.06)",
    accent: "#346bf1",
    on_accent: "#ffffff",
    ok: "#34d399",
    warn: "#f5a524",
    error: "#f85149",
    info: "#38bdf8",
    added: "#3fb950",
    removed: "#f85149",
    added_bg: "rgba(63,185,80,0.10)",
    removed_bg: "rgba(248,81,73,0.10)",
    code_bg: "#111111",
    terminal_bg: "#0d0d0d",
    terminal_fg: "#ececec",
    cursor: "#ececec",
    selection: "#264f78",
    syntax: Syntax {
        default: "#ececec",
        keyword: "#7c9df8",
        operator: "#9aa4b2",
        string: "#7ee2a8",
        function: "#6cd4e6",
        types: "#f0c674",
        property: "#c9d1d9",
        constant: "#f0a070",
        number: "#f0a070",
        parameter: "#e6e6e6",
        builtin: "#7c9df8",
        comment: "#6e7681",
        punctuation: "#9aa4b2",
    },
    ansi: [
        "#1c1c1e", "#f85149", "#3fb950", "#d29922", "#6e9cf7", "#bc8cff", "#39c5cf", "#c9d1d9", "#6e7681", "#ff7b72",
        "#56d364", "#e3b341", "#8fb2ff", "#d2a8ff", "#56d4dd", "#f0f6fc",
    ],
};

pub const DEFAULT_LIGHT: Colors = Colors {
    dark: false,
    canvas: "#fafafa",
    sidebar: "#f2f2f2",
    card: "#ffffff",
    raised: "#ffffff",
    key: "#ececec",
    text: "#1f2328",
    secondary: "#424a53",
    muted: "#6e7781",
    hairline: "alpha(black, 0.08)",
    accent: "#1b4ed8",
    on_accent: "#ffffff",
    ok: "#1a7f37",
    warn: "#9a6700",
    error: "#cf222e",
    info: "#0969da",
    added: "#1a7f37",
    removed: "#cf222e",
    added_bg: "rgba(26,127,55,0.10)",
    removed_bg: "rgba(207,34,46,0.10)",
    code_bg: "#f6f8fa",
    terminal_bg: "#ffffff",
    terminal_fg: "#1f2328",
    cursor: "#1f2328",
    selection: "#c8dcfa",
    syntax: Syntax {
        default: "#1f2328",
        keyword: "#cf222e",
        operator: "#57606a",
        string: "#0a3069",
        function: "#8250df",
        types: "#953800",
        property: "#0550ae",
        constant: "#0550ae",
        number: "#0550ae",
        parameter: "#1f2328",
        builtin: "#cf222e",
        comment: "#6e7781",
        punctuation: "#57606a",
    },
    ansi: [
        "#24292f", "#cf222e", "#116329", "#4d2d00", "#0969da", "#8250df", "#1b7c83", "#6e7781", "#57606a", "#a40e26",
        "#1a7f37", "#633c01", "#218bff", "#a475f9", "#3192aa", "#8c959f",
    ],
};

thread_local! {
    static CURRENT: RefCell<Colors> = const { RefCell::new(DEFAULT_DARK) };
}

pub fn current() -> Colors {
    CURRENT.with(|current| current.borrow().clone())
}

pub fn set_current(colors: &Colors) {
    CURRENT.with(|current| current.replace(colors.clone()));
}

pub fn resolve(theme: Option<&str>, dark: bool) -> Colors {
    match (theme, dark) {
        (Some(GILDRB), true) => GILDRB_DARK,
        (Some(GILDRB), false) => GILDRB_LIGHT,
        (_, true) => DEFAULT_DARK,
        (_, false) => DEFAULT_LIGHT,
    }
}

pub fn css(colors: &Colors) -> String {
    let Colors {
        canvas,
        sidebar,
        card,
        raised,
        key,
        text,
        secondary,
        muted,
        hairline,
        accent,
        on_accent,
        ok,
        warn,
        error,
        info,
        added,
        removed,
        code_bg,
        terminal_bg,
        ..
    } = colors;
    let mut css = format!(
        ":root {{ --window-bg-color: {canvas}; --view-bg-color: {canvas}; --headerbar-bg-color: {canvas}; \
         --headerbar-backdrop-color: {canvas}; --headerbar-shade-color: {hairline}; --headerbar-border-color: {hairline}; \
         --sidebar-bg-color: {sidebar}; --sidebar-backdrop-color: {sidebar}; --sidebar-border-color: {hairline}; \
         --sidebar-shade-color: {hairline}; --secondary-sidebar-bg-color: {sidebar}; --secondary-sidebar-backdrop-color: {sidebar}; \
         --card-bg-color: {card}; --card-shade-color: {hairline}; --dialog-bg-color: {card}; --popover-bg-color: {raised}; \
         --window-fg-color: {text}; --view-fg-color: {text}; --headerbar-fg-color: {text}; --sidebar-fg-color: {text}; \
         --card-fg-color: {text}; --dialog-fg-color: {text}; --popover-fg-color: {text}; --border-color: {hairline}; \
         --accent-bg-color: {accent}; --accent-fg-color: {on_accent}; --accent-color: {accent}; \
         --success-color: {ok}; --success-bg-color: {ok}; --warning-color: {warn}; --warning-bg-color: {warn}; \
         --error-color: {error}; --error-bg-color: {error}; --destructive-color: {error}; }}\n"
    );
    write!(
        css,
        ".ls-meta, .ls-crumb-project {{ color: {muted}; }}\n.ls-shelf {{ color: {secondary}; }}\n\
         .ls-add {{ color: {added}; }}\n.ls-del {{ color: {removed}; }}\n\
         .status-done, .success {{ color: {ok}; }}\n.status-failed, .error {{ color: {error}; }}\n\
         .status-approval, .warning {{ color: {warn}; }}\n.status-working, .status-monitoring {{ color: {accent}; }}\n\
         .status-woke {{ color: {info}; }}\n\
         .ls-code, .ls-tool-detail {{ background: {code_bg}; }}\n.ls-bubble {{ background: {key}; }}\n\
         .ls-tile, .ls-pill, .ls-keycap {{ background: {key}; }}\n\
         .ls-drawer {{ background: {terminal_bg}; }}\n\
         .ls-thread.selected {{ background: alpha({accent}, 0.14); border-color: alpha({accent}, 0.45); }}\n\
         .ls-pr-badge.open {{ color: {ok}; background: alpha({ok}, 0.14); }}\n\
         .ls-pr-badge.merged {{ color: {accent}; background: alpha({accent}, 0.14); }}\n\
         .ls-pr-badge.closed {{ color: {error}; background: alpha({error}, 0.14); }}\n\
         .ls-banner-error {{ background: alpha({error}, 0.16); }}\n"
    )
    .ok();
    css
}
