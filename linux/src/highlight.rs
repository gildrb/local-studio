use std::fmt::Write;

use crate::colors::Syntax;
use crate::format;

const KEYWORDS: [&str; 74] = [
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "crate",
    "def",
    "default",
    "defer",
    "del",
    "do",
    "elif",
    "else",
    "enum",
    "except",
    "export",
    "extends",
    "extern",
    "finally",
    "fn",
    "for",
    "from",
    "func",
    "function",
    "go",
    "guard",
    "if",
    "impl",
    "import",
    "in",
    "interface",
    "is",
    "lambda",
    "let",
    "loop",
    "match",
    "mod",
    "module",
    "move",
    "mut",
    "new",
    "package",
    "pass",
    "private",
    "protected",
    "pub",
    "public",
    "raise",
    "ref",
    "return",
    "static",
    "struct",
    "super",
    "switch",
    "throw",
    "trait",
    "try",
    "type",
    "typeof",
    "unsafe",
    "use",
    "var",
    "where",
    "while",
    "with",
    "yield",
    "then",
    "fi",
    "done",
    "esac",
];

const BUILTINS: [&str; 16] = [
    "true",
    "false",
    "null",
    "nil",
    "None",
    "True",
    "False",
    "self",
    "Self",
    "this",
    "undefined",
    "Some",
    "Ok",
    "Err",
    "echo",
    "print",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Plain,
    Keyword,
    Operator,
    Str,
    Function,
    Type,
    Property,
    Constant,
    Number,
    Builtin,
    Parameter,
    Comment,
    Punctuation,
}

fn hash_comments(language: Option<&str>) -> bool {
    matches!(
        language.map(str::to_ascii_lowercase).as_deref(),
        Some(
            "sh" | "bash"
                | "zsh"
                | "fish"
                | "shell"
                | "console"
                | "py"
                | "python"
                | "rb"
                | "ruby"
                | "yaml"
                | "yml"
                | "toml"
                | "nix"
                | "make"
                | "makefile"
                | "dockerfile"
                | "conf"
                | "ini"
        )
    )
}

pub fn markup(code: &str, language: Option<&str>, syntax: &Syntax) -> String {
    let hashes = hash_comments(language);
    let chars: Vec<char> = code.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    let mut depth = 0_i32;
    let mut previous_dot = false;
    while index < chars.len() {
        let ch = chars[index];
        let start = index;
        let kind = if (ch == '/' && chars.get(index + 1) == Some(&'/')) || (ch == '#' && hashes) {
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            Kind::Comment
        } else if ch == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index < chars.len() && !(chars[index] == '*' && chars.get(index + 1) == Some(&'/')) {
                index += 1;
            }
            index = (index + 2).min(chars.len());
            Kind::Comment
        } else if matches!(ch, '"' | '\'' | '`') {
            index += 1;
            while index < chars.len() && chars[index] != ch && chars[index] != '\n' {
                if chars[index] == '\\' {
                    index += 1;
                }
                index += 1;
            }
            index = (index + 1).min(chars.len());
            Kind::Str
        } else if ch.is_ascii_digit() {
            while index < chars.len() && (chars[index].is_ascii_alphanumeric() || matches!(chars[index], '.' | '_')) {
                index += 1;
            }
            Kind::Number
        } else if ch.is_alphabetic() || ch == '_' {
            while index < chars.len() && (chars[index].is_alphanumeric() || chars[index] == '_') {
                index += 1;
            }
            let word: String = chars[start..index].iter().collect();
            let next = chars[index..].iter().find(|next| !next.is_whitespace());
            if KEYWORDS.contains(&word.as_str()) {
                Kind::Keyword
            } else if BUILTINS.contains(&word.as_str()) {
                Kind::Builtin
            } else if next == Some(&'(') || next == Some(&'!') {
                Kind::Function
            } else if previous_dot {
                Kind::Property
            } else if depth > 0 && next == Some(&':') && chars.get(index + 1) != Some(&':') {
                Kind::Parameter
            } else if word.chars().all(|ch| ch.is_uppercase() || ch == '_' || ch.is_ascii_digit()) && word.len() > 1 {
                Kind::Constant
            } else if word.chars().next().is_some_and(char::is_uppercase) {
                Kind::Type
            } else {
                Kind::Plain
            }
        } else if matches!(ch, '=' | '+' | '-' | '*' | '/' | '<' | '>' | '!' | '&' | '|' | '%' | '^' | '?' | '~') {
            index += 1;
            Kind::Operator
        } else if matches!(ch, '(' | ')' | '{' | '}' | '[' | ']' | ',' | ';' | ':' | '.') {
            depth += match ch {
                '(' => 1,
                ')' => -1,
                _ => 0,
            };
            index += 1;
            Kind::Punctuation
        } else {
            index += 1;
            Kind::Plain
        };
        if !ch.is_whitespace() {
            previous_dot = ch == '.';
        }
        let text: String = chars[start..index].iter().collect();
        let color = match kind {
            Kind::Plain => syntax.default,
            Kind::Keyword => syntax.keyword,
            Kind::Operator => syntax.operator,
            Kind::Str => syntax.string,
            Kind::Function => syntax.function,
            Kind::Type => syntax.types,
            Kind::Property => syntax.property,
            Kind::Constant => syntax.constant,
            Kind::Number => syntax.number,
            Kind::Parameter => syntax.parameter,
            Kind::Builtin => syntax.builtin,
            Kind::Comment => syntax.comment,
            Kind::Punctuation => syntax.punctuation,
        };
        let style = if kind == Kind::Comment { " style=\"italic\"" } else { "" };
        write!(out, "<span foreground=\"{color}\"{style}>{}</span>", format::escape(&text)).ok();
    }
    out
}
