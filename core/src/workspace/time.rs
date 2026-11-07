use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const DAY_MS: i64 = 86_400_000;

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
}

pub(crate) fn days_since_epoch(ms: i64) -> i64 {
    ms.div_euclid(DAY_MS)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

pub(crate) fn day_key(ms: i64) -> String {
    let (year, month, day) = civil_from_days(days_since_epoch(ms));
    format!("{year:04}-{month:02}-{day:02}")
}

pub(crate) fn monday_of(ms: i64) -> i64 {
    let days = days_since_epoch(ms);
    let weekday_from_monday = (days + 3).rem_euclid(7);
    (days - weekday_from_monday) * DAY_MS
}

fn number(text: &str) -> Option<i64> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

pub(crate) fn parse_rfc3339_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    let (date, time) = text.split_once(['T', 't', ' '])?;
    let mut date_parts = date.split('-');
    let year = number(date_parts.next()?)?;
    let month = number(date_parts.next()?)?;
    let day = number(date_parts.next()?)?;
    let (clock, offset_ms) = if let Some(clock) = time.strip_suffix(['Z', 'z']) {
        (clock, 0)
    } else if let Some(index) = time.rfind(['+', '-']) {
        let (clock, offset) = time.split_at(index);
        let sign = if offset.starts_with('-') { -1 } else { 1 };
        let (hours, minutes) = offset[1..].split_once(':').unwrap_or((&offset[1..], "0"));
        (clock, sign * (number(hours)? * 3_600_000 + number(minutes)? * 60_000))
    } else {
        (time, 0)
    };
    let mut clock_parts = clock.split(':');
    let hours = number(clock_parts.next()?)?;
    let minutes = number(clock_parts.next()?)?;
    let seconds_text = clock_parts.next().unwrap_or("0");
    let (seconds, fraction) = seconds_text.split_once('.').unwrap_or((seconds_text, ""));
    let seconds = number(seconds)?;
    let millis = if fraction.is_empty() {
        0
    } else {
        let digits: String = fraction.chars().take(3).collect();
        number(&format!("{digits:0<3}"))?
    };
    let days = days_from_civil(year, month, day);
    Some(days * DAY_MS + hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis - offset_ms)
}
