//! Bestanden wegschrijven naar de Downloads-map (bijlagen en hele berichten).
//!
//! Eén plek voor Graph én IMAP: beide leveren alleen bytes plus een naam, en de
//! naamgeving (verboden tekens, dubbele namen) moet in beide gevallen hetzelfde
//! zijn. Voorheen had elk van de twee zijn eigen kopie, die ook nog net iets
//! anders nummerde ("(1)" tegenover "(2)" bij de eerste dubbele naam).

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// Schrijft `bytes` onder `filename` in de Downloads-map en geeft het volledige
/// pad terug. De naam wordt eerst opgeschoond en, als hij al bestaat,
/// genummerd.
pub fn save_to_downloads(filename: &str, bytes: &[u8]) -> Result<String> {
    let dir = dirs::download_dir()
        .ok_or_else(|| anyhow::anyhow!("Kon de Downloads-map niet vinden."))?;
    let path = unique_path(&dir, &sanitize_filename(filename));
    std::fs::write(&path, bytes).context("Kon het bestand niet opslaan in Downloads.")?;
    Ok(path.to_string_lossy().into_owned())
}

/// Schrijft ruwe MIME als .eml in Downloads en geeft het pad terug. De naam
/// komt uit het onderwerp; .eml opent in Outlook, Thunderbird en de rest.
pub fn write_eml(subject: Option<&str>, bytes: &[u8]) -> Result<String> {
    let base = subject
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("bericht");
    // Lange onderwerpen afkappen: Windows-paden zijn begrensd.
    let base: String = base.chars().take(80).collect();
    save_to_downloads(&format!("{base}.eml"), bytes)
}

/// Namen die Windows voor apparaten reserveert. Ook mét extensie: `CON.eml`
/// wijst naar de console, niet naar een bestand - schrijven "lukt" dan wel,
/// maar er komt geen bestand op de schijf. Vergelijking gaat hoofdletter-
/// ongevoelig en zonder extensie.
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Haalt tekens uit een bestandsnaam die op Windows niet mogen (en padscheiders).
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        return "bijlage".to_string();
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed);
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        format!("_{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Geeft een pad dat nog niet bestaat: "naam.pdf", anders "naam (1).pdf", enz.
fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (filename.to_string(), String::new()),
    };
    for i in 1..1000 {
        let p = dir.join(format!("{stem} ({i}){ext}"));
        if !p.exists() {
            return p;
        }
    }
    dir.join(filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verboden_tekens_worden_vervangen() {
        assert_eq!(sanitize_filename("re: offerte 50%"), "re_ offerte 50%");
        assert_eq!(sanitize_filename("map/naam\\bestand"), "map_naam_bestand");
    }

    #[test]
    fn lege_of_puntnaam_valt_terug() {
        assert_eq!(sanitize_filename("   "), "bijlage");
        assert_eq!(sanitize_filename("..."), "bijlage");
    }

    #[test]
    fn windows_apparaatnamen_krijgen_een_voorvoegsel() {
        // Zonder voorvoegsel schrijft Windows naar het apparaat en blijft de
        // Downloads-map leeg, terwijl de app "opgeslagen" meldt.
        assert_eq!(sanitize_filename("CON.eml"), "_CON.eml");
        assert_eq!(sanitize_filename("nul.pdf"), "_nul.pdf");
        assert_eq!(sanitize_filename("lpt1"), "_lpt1");
        // Een naam die er alleen op lijkt, blijft ongemoeid.
        assert_eq!(sanitize_filename("console.log"), "console.log");
        assert_eq!(sanitize_filename("Contract.pdf"), "Contract.pdf");
    }

    #[test]
    fn nummert_door_bij_een_bestaande_naam() {
        let dir = std::env::temp_dir().join(format!("bemail-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("bericht.eml"));
        let _ = std::fs::remove_file(dir.join("bericht (1).eml"));
        assert_eq!(unique_path(&dir, "bericht.eml"), dir.join("bericht.eml"));
        std::fs::write(dir.join("bericht.eml"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "bericht.eml"), dir.join("bericht (1).eml"));
        let _ = std::fs::remove_file(dir.join("bericht.eml"));
        let _ = std::fs::remove_dir(&dir);
    }
}
