//! Achtergrond-poller: controleert elke minuut Postvak IN en meldt nieuwe
//! berichten via een systeemnotificatie én een "new-mail"-event richting de
//! webview (zodat de lijst en de tellers meteen verversen).

use crate::{auth, config, graph::GraphClient};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const POLL_SECS: u64 = 60;
/// Maximaal aantal losse notificaties per ronde; daarboven één samenvatting.
const MAX_SINGLE: usize = 3;

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Laatst geziene receivedDateTime per account (UTC, ISO - lexicografisch
        // vergelijkbaar). De eerste geslaagde ronde per account registreert
        // alleen; geen notificatie-regen bij start.
        let mut last_seen: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)).await;

            let Ok(Some(cfg)) = config::load() else { continue };
            if !cfg.notifications_enabled {
                // Uitgeschakeld: opnieuw beginnen zodra het weer aan gaat,
                // anders krijg je een stortvloed aan oude meldingen.
                last_seen.clear();
                continue;
            }
            if !cfg.is_complete() {
                continue;
            }

            let multi = cfg.accounts.len() > 1;
            let mut total_fresh = 0usize;
            for acc in &cfg.accounts {
                if !auth::is_logged_in(&acc.id) {
                    continue;
                }
                let Ok(client) = GraphClient::new(&cfg, &acc.id).await else { continue };
                // Well-known map "inbox"; 10 nieuwste is ruim genoeg per minuut.
                let Ok(page) = client.list_messages("inbox", 10, 0).await else { continue };
                let Some(newest) = page
                    .messages
                    .first()
                    .and_then(|m| m.received_date_time.clone())
                else {
                    continue;
                };

                let Some(prev) = last_seen.get(&acc.id).cloned() else {
                    last_seen.insert(acc.id.clone(), newest);
                    continue;
                };
                if newest <= prev {
                    continue;
                }

                let fresh: Vec<_> = page
                    .messages
                    .iter()
                    .filter(|m| {
                        m.received_date_time
                            .as_deref()
                            .map(|d| d > prev.as_str())
                            .unwrap_or(false)
                    })
                    .collect();

                let suffix = if multi {
                    format!(" - {}", acc.mail.clone().unwrap_or_default())
                } else {
                    String::new()
                };
                for m in fresh.iter().take(MAX_SINGLE) {
                    let from = m
                        .from
                        .as_ref()
                        .and_then(|r| {
                            r.email_address
                                .name
                                .clone()
                                .or_else(|| r.email_address.address.clone())
                        })
                        .unwrap_or_else(|| "Nieuw bericht".into());
                    let subject = m.subject.clone().unwrap_or_default();
                    let _ = app
                        .notification()
                        .builder()
                        .title(format!("{from}{suffix}"))
                        .body(subject)
                        .show();
                }
                if fresh.len() > MAX_SINGLE {
                    let _ = app
                        .notification()
                        .builder()
                        .title(format!("BE-Mail{suffix}"))
                        .body(format!("{} nieuwe berichten", fresh.len()))
                        .show();
                }
                total_fresh += fresh.len();
                last_seen.insert(acc.id.clone(), newest);
            }
            if total_fresh > 0 {
                let _ = app.emit("new-mail", total_fresh);
            }
        }
    });
}
