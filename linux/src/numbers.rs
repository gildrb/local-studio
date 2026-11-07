use std::sync::LazyLock;

use gtk::glib;

const COMMA_DECIMAL: [&str; 37] = [
    "de", "fr", "es", "it", "pt", "nl", "ru", "uk", "pl", "cs", "sk", "sl", "hr", "sr", "bg", "ro", "hu", "tr", "sv",
    "da", "nb", "nn", "no", "fi", "et", "lv", "lt", "el", "id", "vi", "ca", "eu", "gl", "az", "kk", "be", "is",
];
const SPACE_GROUP: [&str; 17] =
    ["ru", "uk", "pl", "cs", "sk", "sv", "nb", "nn", "no", "fi", "et", "lv", "lt", "hu", "bg", "be", "kk"];
const SPACED_PERCENT: [&str; 14] = ["de", "fr", "es", "sv", "ru", "uk", "da", "nb", "nn", "no", "fi", "cs", "sk", "is"];
const DOTTED_DAY: [&str; 10] = ["de", "da", "nb", "nn", "no", "fi", "cs", "sk", "sl", "hr"];
const SUNDAY_FIRST: [&str; 8] = ["ja", "zh", "ko", "he", "hi", "th", "fil", "ar"];
const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

struct Locale {
    language: String,
    region: String,
    decimal: char,
    group: &'static str,
}

impl Locale {
    fn from_env(keys: &[&str]) -> Self {
        let tag =
            keys.iter().find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty())).unwrap_or_default();
        let base = tag.split(['.', '@']).next().unwrap_or_default();
        let mut parts = base.split(['_', '-']);
        let language = parts.next().unwrap_or_default().to_lowercase();
        let region = parts.next().unwrap_or_default().to_uppercase();
        let (language, region) = if language.is_empty() || language == "c" || language == "posix" {
            ("en".to_string(), "US".to_string())
        } else {
            (language, region)
        };
        let (decimal, group) = separators(&language, &region);
        Self { language, region, decimal, group }
    }
}

fn separators(language: &str, region: &str) -> (char, &'static str) {
    match (language, region) {
        ("de" | "it", "CH" | "LI") => ('.', "\u{2019}"),
        ("es", "MX" | "US" | "PR" | "DO" | "GT" | "HN" | "NI" | "PA" | "PE" | "SV") => ('.', ","),
        ("pt", "PT") | ("de", "AT") => (',', "\u{a0}"),
        ("fr", _) => (',', "\u{202f}"),
        _ if COMMA_DECIMAL.contains(&language) => (',', if SPACE_GROUP.contains(&language) { "\u{a0}" } else { "." }),
        _ => ('.', ","),
    }
}

static NUMBERS: LazyLock<Locale> = LazyLock::new(|| Locale::from_env(&["LC_ALL", "LC_NUMERIC", "LANG"]));
static DATES: LazyLock<Locale> = LazyLock::new(|| Locale::from_env(&["LC_ALL", "LC_TIME", "LANG"]));

fn numbers() -> &'static Locale {
    &NUMBERS
}

fn dates() -> &'static Locale {
    &DATES
}

fn grouped(digits: &str) -> String {
    let group = numbers().group;
    let count = digits.len();
    let mut out = String::with_capacity(count + count / 3 * group.len());
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (count - index).is_multiple_of(3) {
            out.push_str(group);
        }
        out.push(digit);
    }
    out
}

pub fn fixed(value: f64, digits: usize) -> String {
    let text = format!("{:.*}", digits, value.abs());
    let (whole, fraction) = text.split_once('.').map_or((text.as_str(), None), |(whole, rest)| (whole, Some(rest)));
    let mut out = String::new();
    if value < 0.0 && text.chars().any(|digit| digit.is_ascii_digit() && digit != '0') {
        out.push('-');
    }
    out.push_str(&grouped(whole));
    if let Some(fraction) = fraction {
        out.push(numbers().decimal);
        out.push_str(fraction);
    }
    out
}

pub fn decimal(value: f64) -> String {
    fixed(value, 1)
}

pub fn whole(value: f64) -> String {
    fixed(value, 0)
}

pub fn count(value: u64) -> String {
    grouped(&value.to_string())
}

pub fn percent(value: f64) -> String {
    let locale = numbers();
    let number = whole(value);
    match locale.language.as_str() {
        "fr" => format!("{number}\u{202f}%"),
        "tr" => format!("%{number}"),
        language if SPACED_PERCENT.contains(&language) => format!("{number}\u{a0}%"),
        _ => format!("{number}%"),
    }
}

fn units(language: &str) -> ([&'static str; 4], bool) {
    match language {
        "de" => (["", "\u{a0}Mio.", "\u{a0}Mrd.", "\u{a0}Bio."], true),
        "it" => (["", "\u{a0}Mln", "\u{a0}Mrd", "\u{a0}Bln"], true),
        "fr" => (["\u{a0}k", "\u{a0}M", "\u{a0}Md", "\u{a0}Bn"], false),
        "es" => (["\u{a0}mil", "\u{a0}M", "\u{a0}mil\u{a0}M", "\u{a0}B"], false),
        "pt" => (["\u{a0}mil", "\u{a0}mi", "\u{a0}bi", "\u{a0}tri"], false),
        "nl" => (["K", "\u{a0}mln.", "\u{a0}mld.", "\u{a0}bln."], false),
        "ru" => (["\u{a0}тыс.", "\u{a0}млн", "\u{a0}млрд", "\u{a0}трлн"], false),
        _ => (["K", "M", "B", "T"], false),
    }
}

pub fn compact(value: u64) -> String {
    let (suffixes, full_thousands) = units(&numbers().language);
    #[allow(clippy::cast_precision_loss)]
    let mut scaled = value as f64;
    let mut unit = 0;
    while unit < suffixes.len() && (scaled * 10.0).round() / 10.0 >= 1000.0 {
        scaled /= 1000.0;
        unit += 1;
    }
    if unit == 0 || (unit == 1 && full_thousands) {
        return count(value);
    }
    let mut number = fixed(scaled, 1);
    let zero = format!("{}0", numbers().decimal);
    if number.ends_with(&zero) {
        number.truncate(number.len() - zero.len());
    }
    format!("{number}{}", suffixes[unit - 1])
}

pub fn parse_day(day: &str) -> Option<i64> {
    let mut parts = day.trim().split('-').map(str::parse::<i64>);
    let (Some(Ok(year)), Some(Ok(month)), Some(Ok(date))) = (parts.next(), parts.next(), parts.next()) else {
        return None;
    };
    ((1..=12).contains(&month) && (1..=31).contains(&date)).then(|| days_from_civil(year, month, date))
}

fn days_from_civil(year: i64, month: i64, date: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted = (month + 9) % 12;
    let day_of_year = (153 * shifted + 2) / 5 + date - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

pub fn civil(days: i64) -> (i64, i64, i64) {
    let shifted_days = days + 719_468;
    let era = shifted_days.div_euclid(146_097);
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * day_of_year + 2) / 153;
    let date = day_of_year - (153 * shifted + 2) / 5 + 1;
    let month = if shifted < 10 { shifted + 3 } else { shifted - 9 };
    let year = year_of_era + era * 400;
    (if month <= 2 { year + 1 } else { year }, month, date)
}

pub fn weekday(days: i64) -> i64 {
    (days + 4).rem_euclid(7)
}

pub fn today() -> i64 {
    crate::format::now_ms().div_euclid(86_400_000)
}

pub fn first_weekday() -> i64 {
    let locale = dates();
    let sunday = match (locale.language.as_str(), locale.region.as_str()) {
        ("en", "US" | "CA" | "PH" | "") | ("pt", "BR") | ("es", "MX" | "US") => true,
        (language, _) => SUNDAY_FIRST.contains(&language),
    };
    i64::from(!sunday)
}

pub fn month_name(month: i64) -> String {
    let index = usize::try_from(month - 1).unwrap_or_default().min(11);
    i32::try_from(month)
        .ok()
        .and_then(|month| glib::DateTime::from_utc(2001, month, 1, 0, 0, 0.0).ok())
        .and_then(|date| date.format("%b").ok())
        .map_or_else(|| MONTHS[index].to_string(), |name| name.trim().to_string())
}

pub fn day(days: i64, year: bool) -> String {
    let (number, month, date) = civil(days);
    let locale = dates();
    let name = month_name(month);
    match (locale.language.as_str(), locale.region.as_str(), year) {
        ("en", "US" | "CA" | "PH" | "", true) => format!("{name} {date}, {number}"),
        ("en", "US" | "CA" | "PH" | "", false) => format!("{name} {date}"),
        ("ja" | "zh", _, true) => format!("{number}年{month}月{date}日"),
        ("ja" | "zh", _, false) => format!("{month}月{date}日"),
        ("ko", _, true) => format!("{number}년 {month}월 {date}일"),
        ("ko", _, false) => format!("{month}월 {date}일"),
        (language, _, true) if DOTTED_DAY.contains(&language) => format!("{date}. {name} {number}"),
        (language, _, false) if DOTTED_DAY.contains(&language) => format!("{date}. {name}"),
        (_, _, true) => format!("{date} {name} {number}"),
        (_, _, false) => format!("{date} {name}"),
    }
}

pub fn loaded(milliseconds: i64) -> String {
    let seconds = (crate::format::now_ms() - milliseconds).max(0) / 1000;
    let (amount, unit) = match seconds {
        0..=59 => (0, ""),
        60..=3599 => (seconds / 60, "minute"),
        3600..=86_399 => (seconds / 3600, "hour"),
        _ => (seconds / 86_400, "day"),
    };
    if amount == 0 {
        return "Loaded just now".to_string();
    }
    let plural = if amount == 1 { "" } else { "s" };
    format!("Loaded {} {unit}{plural} ago", count(amount.unsigned_abs()))
}

pub fn gigabytes(bytes: u64) -> String {
    #[allow(clippy::cast_precision_loss)]
    let value = bytes as f64 / 1_073_741_824.0;
    whole(value)
}
