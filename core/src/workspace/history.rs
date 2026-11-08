use super::model::TokenHistory;
use super::time::{day_key, days_since_epoch, DAY_MS};

pub(crate) const HEATMAP_DAYS: usize = 378;
const YEAR_DAYS: i64 = 365;

pub(crate) struct DayTokens {
    pub(crate) day: i64,
    pub(crate) read: u64,
    pub(crate) written: u64,
}

pub(crate) fn heatmap_slot(day: i64, today: i64) -> Option<usize> {
    let age = usize::try_from(today - day).ok().filter(|age| *age < HEATMAP_DAYS)?;
    Some(HEATMAP_DAYS - 1 - age)
}

pub(crate) fn token_history(
    days: impl IntoIterator<Item = DayTokens>,
    first_day: Option<i64>,
    now: i64,
) -> TokenHistory {
    let today = days_since_epoch(now);
    let mut daily = vec![0_u64; HEATMAP_DAYS];
    let mut history = TokenHistory { last_day: day_key(now), ..TokenHistory::default() };
    let mut since = first_day;
    let mut busiest: Option<(i64, u64)> = None;
    for DayTokens { day, read, written } in days {
        since = Some(since.map_or(day, |since| since.min(day)));
        let tokens = read.saturating_add(written);
        history.read = history.read.saturating_add(read);
        history.written = history.written.saturating_add(written);
        let age = today - day;
        if (0..7).contains(&age) {
            history.last_week = history.last_week.saturating_add(tokens);
        }
        if tokens > 0 && (0..YEAR_DAYS).contains(&age) {
            history.active_days += 1;
            if busiest.is_none_or(|(_, most)| tokens > most) {
                busiest = Some((day, tokens));
            }
        }
        if let Some(slot) = heatmap_slot(day, today) {
            daily[slot] = daily[slot].saturating_add(tokens);
        }
    }
    history.total = history.read.saturating_add(history.written);
    history.since_day = since.map(|since| day_key(since * DAY_MS));
    history.tracked_days = since.map_or(0, |since| u32::try_from((today - since + 1).clamp(0, YEAR_DAYS)).unwrap_or(0));
    history.busiest_day = busiest.map(|(day, _)| day_key(day * DAY_MS));
    history.busiest_tokens = busiest.map_or(0, |(_, tokens)| tokens);
    history.daily = daily;
    history
}
