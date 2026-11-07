use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

use syntect::easy::ScopeRangeIterator;
use syntect::parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet};

const MAX_BYTES: usize = 512 * 1024;
const MAX_LINES: usize = 20_000;
const MAX_LINE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum SyntaxKind {
    Plain,
    Comment,
    Keyword,
    Operator,
    String,
    Function,
    Type,
    Property,
    Constant,
    Number,
    Parameter,
    Builtin,
    Punctuation,
    Variable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct CodeSegment {
    pub text: String,
    pub kind: SyntaxKind,
}

const SCOPE_KINDS: &[(&str, SyntaxKind)] = &[
    ("comment", SyntaxKind::Comment),
    ("punctuation.definition.comment", SyntaxKind::Comment),
    ("markup.quote", SyntaxKind::Comment),
    ("meta.diff.header", SyntaxKind::Comment),
    ("meta.diff.range", SyntaxKind::Comment),
    ("string", SyntaxKind::String),
    ("punctuation.definition.string", SyntaxKind::String),
    ("markup.raw", SyntaxKind::String),
    ("markup.inserted", SyntaxKind::String),
    ("constant.numeric", SyntaxKind::Number),
    ("keyword.other.unit", SyntaxKind::Number),
    ("markup.deleted", SyntaxKind::Number),
    ("constant", SyntaxKind::Constant),
    ("entity.name.constant", SyntaxKind::Constant),
    ("variable.other.constant", SyntaxKind::Constant),
    ("support.constant", SyntaxKind::Constant),
    ("markup.changed", SyntaxKind::Constant),
    ("keyword", SyntaxKind::Keyword),
    ("storage", SyntaxKind::Keyword),
    ("keyword.operator.word", SyntaxKind::Keyword),
    ("keyword.operator.new", SyntaxKind::Keyword),
    ("keyword.operator.expression", SyntaxKind::Keyword),
    ("entity.name.tag", SyntaxKind::Keyword),
    ("entity.name.tag.yaml", SyntaxKind::Property),
    ("entity.name.tag.toml", SyntaxKind::Property),
    ("markup.heading", SyntaxKind::Keyword),
    ("keyword.operator", SyntaxKind::Operator),
    ("storage.type.function.arrow", SyntaxKind::Operator),
    ("entity.name.function", SyntaxKind::Function),
    ("variable.function", SyntaxKind::Function),
    ("support.function", SyntaxKind::Function),
    ("support.macro", SyntaxKind::Function),
    ("markup.underline.link", SyntaxKind::Function),
    ("entity.name", SyntaxKind::Type),
    ("entity.other.inherited-class", SyntaxKind::Type),
    ("support.type", SyntaxKind::Type),
    ("support.class", SyntaxKind::Type),
    ("storage.type.primitive", SyntaxKind::Type),
    ("storage.type.numeric", SyntaxKind::Type),
    ("variable.other.member", SyntaxKind::Property),
    ("variable.other.property", SyntaxKind::Property),
    ("variable.other.object.property", SyntaxKind::Property),
    ("variable.object.property", SyntaxKind::Property),
    ("support.variable.property", SyntaxKind::Property),
    ("meta.object-literal.key", SyntaxKind::Property),
    ("support.type.property-name", SyntaxKind::Property),
    ("entity.other.attribute-name", SyntaxKind::Property),
    ("variable.parameter", SyntaxKind::Parameter),
    ("variable.language", SyntaxKind::Builtin),
    ("support.variable", SyntaxKind::Builtin),
    ("support", SyntaxKind::Builtin),
    ("variable", SyntaxKind::Variable),
    ("punctuation", SyntaxKind::Punctuation),
];

const PRIMITIVE_TYPES: &[&str] = &[
    "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64", "bool",
    "char", "str", "int", "float", "double", "long", "short", "byte", "void",
];

const CONTAINER_KINDS: &[(&str, SyntaxKind)] = &[("meta.mapping.key", SyntaxKind::Property)];

const LANGUAGE_ALIASES: &[(&str, &str)] = &[
    ("typescript", "ts"),
    ("mts", "ts"),
    ("cts", "ts"),
    ("javascript", "js"),
    ("node", "js"),
    ("mjs", "js"),
    ("cjs", "js"),
    ("shell", "bash"),
    ("sh", "bash"),
    ("zsh", "bash"),
    ("shellscript", "bash"),
    ("console", "bash"),
    ("nu", "bash"),
    ("nushell", "bash"),
    ("rust", "rs"),
    ("python", "py"),
    ("python3", "py"),
    ("ruby", "rb"),
    ("golang", "go"),
    ("kotlin", "kt"),
    ("csharp", "cs"),
    ("c#", "cs"),
    ("c++", "cpp"),
    ("objective-c", "m"),
    ("objc", "m"),
    ("objective-cpp", "mm"),
    ("yml", "yaml"),
    ("markdown", "md"),
    ("jsonc", "json"),
    ("json5", "json"),
    ("jsonl", "json"),
    ("dockerfile", "Dockerfile"),
    ("docker", "Dockerfile"),
    ("makefile", "Makefile"),
    ("make", "Makefile"),
    ("patch", "diff"),
    ("elixir", "ex"),
    ("haskell", "hs"),
    ("ocaml", "ml"),
    ("swift", "swift"),
    ("toml", "toml"),
];

const PLAIN_LANGUAGES: &[&str] = &["text", "txt", "plain", "plaintext", "output", "log"];

struct Rules {
    scopes: Vec<(Scope, SyntaxKind)>,
    containers: Vec<(Scope, SyntaxKind)>,
}

static SYNTAXES: LazyLock<SyntaxSet> = LazyLock::new(two_face::syntax::extra_newlines);
static RULES: LazyLock<Rules> =
    LazyLock::new(|| Rules { scopes: compile(SCOPE_KINDS), containers: compile(CONTAINER_KINDS) });

fn compile(table: &[(&str, SyntaxKind)]) -> Vec<(Scope, SyntaxKind)> {
    table.iter().filter_map(|(name, kind)| Scope::new(name).ok().map(|scope| (scope, *kind))).collect()
}

fn longest_match(table: &[(Scope, SyntaxKind)], scope: Scope) -> Option<SyntaxKind> {
    let mut best: Option<(u32, SyntaxKind)> = None;
    for (prefix, kind) in table {
        if prefix.is_prefix_of(scope) && best.is_none_or(|(len, _)| prefix.len() > len) {
            best = Some((prefix.len(), *kind));
        }
    }
    best.map(|(_, kind)| kind)
}

#[derive(Default)]
struct Classifier {
    scopes: HashMap<Scope, Option<SyntaxKind>>,
    containers: HashMap<Scope, Option<SyntaxKind>>,
}

impl Classifier {
    fn kind(&mut self, stack: &[Scope]) -> SyntaxKind {
        let rules = &*RULES;
        let mut inner = None;
        for scope in stack.iter().rev() {
            let kind = *self.scopes.entry(*scope).or_insert_with(|| longest_match(&rules.scopes, *scope));
            if kind.is_some() {
                inner = kind;
                break;
            }
        }
        if inner == Some(SyntaxKind::Comment) {
            return SyntaxKind::Comment;
        }
        for scope in stack {
            let container = *self.containers.entry(*scope).or_insert_with(|| longest_match(&rules.containers, *scope));
            if let Some(kind) = container {
                return kind;
            }
        }
        inner.unwrap_or(SyntaxKind::Plain)
    }
}

fn plain_language(token: &str) -> bool {
    PLAIN_LANGUAGES.contains(&token)
}

fn fence_token(language: &str) -> String {
    let token = language
        .trim()
        .trim_start_matches('{')
        .trim_start_matches('.')
        .split(|character: char| character.is_whitespace() || matches!(character, ',' | '{' | '}' | ':'))
        .next()
        .unwrap_or_default()
        .to_lowercase();
    token.strip_prefix("language-").map_or(token.clone(), str::to_string)
}

fn usable(syntax: &SyntaxReference) -> Option<&SyntaxReference> {
    (syntax.name != "Plain Text").then_some(syntax)
}

enum Fence<'a> {
    Missing,
    Plain,
    Syntax(&'a SyntaxReference),
}

fn by_language<'a>(set: &'a SyntaxSet, language: &str) -> Fence<'a> {
    let token = fence_token(language);
    if token.is_empty() {
        return Fence::Missing;
    }
    if plain_language(&token) {
        return Fence::Plain;
    }
    let alias = LANGUAGE_ALIASES.iter().find(|(name, _)| *name == token).map_or(token.as_str(), |(_, target)| target);
    set.find_syntax_by_token(alias)
        .or_else(|| set.find_syntax_by_token(&token))
        .and_then(usable)
        .map_or(Fence::Missing, Fence::Syntax)
}

fn by_path<'a>(set: &'a SyntaxSet, path: &str) -> Option<&'a SyntaxReference> {
    let path = Path::new(path);
    let name = path.file_name()?.to_str()?;
    set.find_syntax_by_extension(name)
        .or_else(|| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .and_then(|extension| set.find_syntax_by_extension(extension))
        })
        .and_then(usable)
}

fn resolve<'a>(
    set: &'a SyntaxSet,
    language: Option<&str>,
    path: Option<&str>,
    first_line: &str,
) -> Option<&'a SyntaxReference> {
    match language.map_or(Fence::Missing, |language| by_language(set, language)) {
        Fence::Plain => return None,
        Fence::Syntax(syntax) => return Some(syntax),
        Fence::Missing => {}
    }
    path.and_then(|path| by_path(set, path)).or_else(|| set.find_syntax_by_first_line(first_line).and_then(usable))
}

fn push(segments: &mut Vec<CodeSegment>, text: &str, kind: SyntaxKind) {
    if text.is_empty() {
        return;
    }
    match segments.last_mut() {
        Some(last) if last.kind == kind => last.text.push_str(text),
        _ => segments.push(CodeSegment { text: text.to_string(), kind }),
    }
}

struct LineParser<'a> {
    set: &'a SyntaxSet,
    state: Option<ParseState>,
    stack: ScopeStack,
    classifier: Classifier,
}

impl<'a> LineParser<'a> {
    fn new(set: &'a SyntaxSet, syntax: &SyntaxReference) -> Self {
        Self { set, state: Some(ParseState::new(syntax)), stack: ScopeStack::new(), classifier: Classifier::default() }
    }

    fn line(&mut self, line: &str, segments: &mut Vec<CodeSegment>) {
        if line.len() > MAX_LINE_BYTES {
            push(segments, line, SyntaxKind::Plain);
            return;
        }
        let Some(state) = self.state.as_mut() else {
            push(segments, line, SyntaxKind::Plain);
            return;
        };
        let Ok(ops) = state.parse_line(line, self.set) else {
            self.state = None;
            push(segments, line, SyntaxKind::Plain);
            return;
        };
        for (range, op) in ScopeRangeIterator::new(&ops, line) {
            if self.stack.apply(op).is_err() {
                self.state = None;
                push(segments, &line[range.start..], SyntaxKind::Plain);
                return;
            }
            if range.is_empty() {
                continue;
            }
            let text = &line[range];
            let kind = match self.classifier.kind(self.stack.as_slice()) {
                SyntaxKind::Keyword if PRIMITIVE_TYPES.contains(&text) => SyntaxKind::Type,
                kind => kind,
            };
            push(segments, text, kind);
        }
    }
}

fn first_line(code: &str) -> &str {
    code.lines().next().unwrap_or_default()
}

pub(crate) fn highlight_code(code: &str, language: Option<&str>, path: Option<&str>) -> Vec<CodeSegment> {
    let plain = || vec![CodeSegment { text: code.to_string(), kind: SyntaxKind::Plain }];
    if code.is_empty() {
        return Vec::new();
    }
    if code.len() > MAX_BYTES || code.lines().nth(MAX_LINES).is_some() {
        return plain();
    }
    let set = &*SYNTAXES;
    let Some(syntax) = resolve(set, language, path, first_line(code)) else {
        return plain();
    };
    let mut parser = LineParser::new(set, syntax);
    let mut segments = Vec::new();
    for line in code.split_inclusive('\n') {
        parser.line(line, &mut segments);
    }
    segments
}

pub(crate) fn highlight_code_lines(
    lines: &[String],
    language: Option<&str>,
    path: Option<&str>,
) -> Vec<Vec<CodeSegment>> {
    let plain = || {
        lines
            .iter()
            .map(|line| {
                if line.is_empty() {
                    Vec::new()
                } else {
                    vec![CodeSegment { text: line.clone(), kind: SyntaxKind::Plain }]
                }
            })
            .collect()
    };
    let bytes = lines.iter().map(String::len).sum::<usize>();
    if lines.len() > MAX_LINES || bytes > MAX_BYTES {
        return plain();
    }
    let set = &*SYNTAXES;
    let Some(syntax) = resolve(set, language, path, lines.first().map_or("", String::as_str)) else {
        return plain();
    };
    let mut parser = LineParser::new(set, syntax);
    let mut buffer = String::new();
    lines
        .iter()
        .map(|line| {
            buffer.clear();
            buffer.push_str(line);
            buffer.push('\n');
            let mut segments = Vec::new();
            parser.line(&buffer, &mut segments);
            if let Some(last) = segments.last_mut() {
                if last.text.ends_with('\n') {
                    last.text.pop();
                }
                if last.text.is_empty() {
                    segments.pop();
                }
            }
            segments
        })
        .collect()
}

#[cfg_attr(feature = "ffi", uniffi::export)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn highlight(code: String, language: Option<String>, path: Option<String>) -> Vec<CodeSegment> {
    highlight_code(&code, language.as_deref(), path.as_deref())
}

#[cfg_attr(feature = "ffi", uniffi::export)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn highlight_lines(lines: Vec<String>, language: Option<String>, path: Option<String>) -> Vec<Vec<CodeSegment>> {
    highlight_code_lines(&lines, language.as_deref(), path.as_deref())
}
