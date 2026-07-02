// Voorkomt een extra consolevenster op Windows in release. NIET verwijderen.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    be_mail_lib::run()
}
