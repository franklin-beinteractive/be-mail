use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Overgang van '{van}' naar '{naar}' is niet toegestaan")]
    OngeldigeOvergang { van: String, naar: String },

    #[error("{0}")]
    Validatie(String),

    #[error("Kaart {0} niet gevonden")]
    NietGevonden(i64),

    #[error("Databasefout: {0}")]
    Database(#[from] rusqlite::Error),
}

// Tauri serialiseert command-errors naar de frontend; wij sturen de nette NL-melding.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
