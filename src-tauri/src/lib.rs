//! BE-Mail - Rust-kern.
//! De kern fungeert als "trusted backend": alle Graph-calls en tokens leven hier,
//! nooit in de webview.

mod auth;
mod cache;
mod claude;
mod commands;
mod config;
mod graph;
mod models;
mod notifier;
mod token_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Achtergrond-poller voor nieuwe-mail-notificaties.
            notifier::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::set_notifications_enabled,
            commands::auth_status,
            commands::login,
            commands::logout,
            commands::list_accounts,
            commands::set_active_account,
            commands::list_all_folders,
            commands::get_account,
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_folder,
            commands::list_messages,
            commands::get_message,
            commands::set_read,
            commands::set_flag,
            commands::delete_message,
            commands::move_message,
            commands::send_message,
            commands::search_messages,
            commands::claude_key_status,
            commands::set_claude_key,
            commands::ai_reply,
            commands::create_draft,
            commands::update_draft,
            commands::send_draft,
            commands::list_attachments,
            commands::inline_images,
            commands::download_attachment,
            commands::move_message_returning,
            commands::list_rules,
            commands::set_rule_enabled,
            commands::delete_rule,
            commands::get_auto_reply,
            commands::set_auto_reply,
            commands::list_categories,
            commands::set_message_categories,
            commands::rsvp_message,
            commands::block_sender,
            commands::list_events,
            commands::create_event,
            commands::update_event,
            commands::update_event_times,
            commands::search_people,
            commands::delete_event,
        ])
        .run(tauri::generate_context!())
        .expect("Fout bij het starten van BE-Mail");
}
