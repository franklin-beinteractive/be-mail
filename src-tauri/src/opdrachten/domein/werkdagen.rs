use chrono::{Datelike, Duration, NaiveDate, Weekday};

fn is_werkdag(d: NaiveDate) -> bool {
    !matches!(d.weekday(), Weekday::Sat | Weekday::Sun)
}

/// Aantal werkdagen (ma–vr) ná `van`, tot en met `tot`.
/// Voorbeeld: van = maandag, tot = donderdag → di + wo + do = 3 werkdagen "verstreken".
/// Feestdagen tellen bewust mee als werkdag (MVP-versimpeling; drempels zijn instelbaar).
pub fn werkdagen_sinds(van: NaiveDate, tot: NaiveDate) -> u32 {
    if tot <= van {
        return 0;
    }
    let mut d = van + Duration::days(1);
    let mut n = 0;
    while d <= tot {
        if is_werkdag(d) {
            n += 1;
        }
        d += Duration::days(1);
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn zelfde_dag_is_nul() {
        assert_eq!(werkdagen_sinds(d("2026-07-06"), d("2026-07-06")), 0); // maandag
    }

    #[test]
    fn tot_voor_van_is_nul() {
        assert_eq!(werkdagen_sinds(d("2026-07-08"), d("2026-07-06")), 0);
    }

    #[test]
    fn maandag_tot_donderdag_is_drie() {
        assert_eq!(werkdagen_sinds(d("2026-07-06"), d("2026-07-09")), 3);
    }

    #[test]
    fn weekend_telt_niet_mee() {
        // vrijdag → maandag: alleen maandag telt
        assert_eq!(werkdagen_sinds(d("2026-07-10"), d("2026-07-13")), 1);
        // vrijdag → zondag: nul werkdagen
        assert_eq!(werkdagen_sinds(d("2026-07-10"), d("2026-07-12")), 0);
    }

    #[test]
    fn hele_week() {
        // maandag → maandag erop: di wo do vr + ma = 5
        assert_eq!(werkdagen_sinds(d("2026-07-06"), d("2026-07-13")), 5);
    }

    #[test]
    fn start_in_weekend() {
        // zaterdag → dinsdag: ma + di = 2
        assert_eq!(werkdagen_sinds(d("2026-07-11"), d("2026-07-14")), 2);
    }
}
