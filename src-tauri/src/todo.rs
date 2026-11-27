//! Personal task board ("Taken"): projects, user-defined columns shared by
//! all projects, cards (tasks) that live in one column, and attachments
//! (screenshots and files) stored as BLOBs. This is primary data, so it lives
//! in its own SQLite file (`todo.db`) next to the throwaway mail cache.
//! Nothing here talks to Microsoft Graph; a card only remembers which mail it
//! came from so the frontend can open that mail again.

use std::sync::{Mutex, MutexGuard, OnceLock};

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

/// Migrations in order; `PRAGMA user_version` records how many have run.
/// Never edit a migration that has shipped: existing databases already ran it.
const MIGRATIONS: &[&str] = &[
    r#"
    CREATE TABLE project (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        color      TEXT NOT NULL DEFAULT '',
        archived   INTEGER NOT NULL DEFAULT 0,
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    CREATE TABLE action (
        id      INTEGER PRIMARY KEY,
        label   TEXT NOT NULL,
        waiting INTEGER NOT NULL DEFAULT 0,
        color   TEXT NOT NULL DEFAULT '',
        sort    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE task (
        id                INTEGER PRIMARY KEY,
        title             TEXT NOT NULL,
        project_id        INTEGER REFERENCES project(id) ON DELETE SET NULL,
        status            TEXT NOT NULL DEFAULT 'todo'
                          CHECK (status IN ('todo', 'doing', 'done')),
        action_id         INTEGER REFERENCES action(id) ON DELETE SET NULL,
        follow_up         TEXT,
        note              TEXT NOT NULL DEFAULT '',
        mail_account      TEXT,
        mail_id           TEXT,
        mail_conversation TEXT,
        mail_subject      TEXT,
        mail_from         TEXT,
        mail_address      TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        done_at           TEXT
    );
    CREATE INDEX idx_task_project ON task(project_id);
    CREATE INDEX idx_task_status ON task(status);

    -- Starting set of action labels; the user edits them in Settings.
    INSERT INTO action (label, waiting, color, sort) VALUES
        ('Mail sturen', 0, '#0f6cbd', 1),
        ('Bellen', 0, '#8764b8', 2),
        ('Nog live zetten', 0, '#ca5010', 3),
        ('Wachten op collega', 1, '#498205', 4),
        ('Wachten op antwoord klant', 1, '#c19c00', 5);
"#,
    // 2: board columns replace both the fixed status and the action labels;
    // cards get a colour and a position, and attachments arrive. SQLite cannot
    // drop `action_id` (it carries a foreign key), so `task` is rebuilt.
    r#"
    CREATE TABLE board_column (
        id    INTEGER PRIMARY KEY,
        name  TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        done  INTEGER NOT NULL DEFAULT 0,
        sort  INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO board_column (name, color, done, sort) VALUES
        ('Te doen', '#0f6cbd', 0, 1),
        ('Bezig', '#8764b8', 0, 2),
        ('Wacht op klant', '#c19c00', 0, 3),
        ('Klaar', '#498205', 1, 4);

    CREATE TABLE task_new (
        id                INTEGER PRIMARY KEY,
        title             TEXT NOT NULL,
        project_id        INTEGER REFERENCES project(id) ON DELETE SET NULL,
        column_id         INTEGER NOT NULL REFERENCES board_column(id),
        color             TEXT NOT NULL DEFAULT '',
        sort              REAL NOT NULL DEFAULT 0,
        follow_up         TEXT,
        note              TEXT NOT NULL DEFAULT '',
        mail_account      TEXT,
        mail_id           TEXT,
        mail_conversation TEXT,
        mail_subject      TEXT,
        mail_from         TEXT,
        mail_address      TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        done_at           TEXT
    );
    -- The old id keeps the old order within each column. A project that no
    -- longer exists becomes NULL, so the foreign key check cannot fail.
    INSERT INTO task_new (id, title, project_id, column_id, color, sort, follow_up,
        note, mail_account, mail_id, mail_conversation, mail_subject, mail_from,
        mail_address, created_at, updated_at, done_at)
    SELECT t.id, t.title,
        (SELECT p.id FROM project p WHERE p.id = t.project_id),
        (SELECT c.id FROM board_column c
          WHERE c.name = CASE t.status WHEN 'doing' THEN 'Bezig'
                                       WHEN 'done' THEN 'Klaar'
                                       ELSE 'Te doen' END
          ORDER BY c.id LIMIT 1),
        '', CAST(t.id AS REAL), t.follow_up, t.note, t.mail_account, t.mail_id,
        t.mail_conversation, t.mail_subject, t.mail_from, t.mail_address,
        t.created_at, t.updated_at,
        CASE WHEN t.status = 'done' THEN COALESCE(t.done_at, t.updated_at) END
    FROM task t;
    DROP TABLE task;
    DROP TABLE action;
    ALTER TABLE task_new RENAME TO task;
    CREATE INDEX idx_task_project ON task(project_id);
    CREATE INDEX idx_task_column ON task(column_id);

    CREATE TABLE attachment (
        id         INTEGER PRIMARY KEY,
        task_id    INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL DEFAULT '',
        size       INTEGER NOT NULL,
        data       BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_attachment_task ON attachment(task_id);
"#,
    // Cards put in the archive by hand. Cards in a done column also go there
    // by themselves after a few days; the frontend works that out from done_at.
    r#"
    ALTER TABLE task ADD COLUMN archived_at TEXT;
"#,
];

/// Largest attachment accepted, in bytes.
const MAX_ATTACHMENT: usize = 25 * 1024 * 1024;

/// Extensions that run code when opened with the default app. Such
/// attachments can only be saved to Downloads, never opened from the board.
const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi",
    "msp", "scr", "pif", "lnk", "hta", "cpl", "jar", "reg", "appx", "msix",
    // Not in the original list, but they run code or redirect to it as well.
    "appxbundle", "msixbundle", "application", "appref-ms", "chm", "inf", "ps1xml", "psd1",
    "scf", "settingcontent-ms", "url", "vb", "wsc",
];

// ---- Models (camelCase towards the frontend) ----

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub archived: bool,
    pub sort: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub archived: bool,
}

/// A board column, shared by all projects.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: i64,
    pub name: String,
    pub color: String,
    /// Cards in this column count as finished (they get a `doneAt`).
    pub done: bool,
    pub sort: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub done: bool,
}

/// The mail a task was made from. Graph message ids change when a message
/// moves folders, so the conversation id is kept as a fallback.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MailLink {
    pub account_id: String,
    pub message_id: String,
    pub conversation_id: Option<String>,
    pub subject: String,
    pub from: String,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub project_id: Option<i64>,
    pub column_id: i64,
    /// Card colour: "" or `#rrggbb`.
    pub color: String,
    /// Position within the column; fractional so a card can slot in between.
    pub sort: f64,
    /// Date (YYYY-MM-DD) on which to look at the task again.
    pub follow_up: Option<String>,
    /// The card description.
    pub note: String,
    pub mail: Option<MailLink>,
    pub created_at: String,
    pub updated_at: String,
    pub done_at: Option<String>,
    /// Set when the card was archived by hand.
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub project_id: Option<i64>,
    /// None = the first column.
    #[serde(default)]
    pub column_id: Option<i64>,
    #[serde(default)]
    pub color: String,
    /// None = append (new card or card moved to another column) or keep.
    #[serde(default)]
    pub sort: Option<f64>,
    #[serde(default)]
    pub follow_up: Option<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub mail: Option<MailLink>,
}

/// Attachment without its bytes; those come from `todo_attachment_data`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMeta {
    pub id: i64,
    pub task_id: i64,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoData {
    pub projects: Vec<Project>,
    pub columns: Vec<Column>,
    pub tasks: Vec<Task>,
    pub attachments: Vec<AttachmentMeta>,
}

// ---- Database ----

fn db() -> anyhow::Result<MutexGuard<'static, Connection>> {
    if DB.get().is_none() {
        let dir = crate::config::data_dir()?;
        std::fs::create_dir_all(&dir).context("Kon de datamap niet aanmaken")?;
        // A dev build gets its own file so testing never touches real tasks.
        let name = if cfg!(debug_assertions) { "todo-dev.db" } else { "todo.db" };
        let conn = Connection::open(dir.join(name)).context("Kon todo.db niet openen")?;
        init_conn(&conn).context("Kon de takenlijst niet bijwerken naar de nieuwe versie")?;
        // Race on a simultaneous first call: the loser drops its connection.
        let _ = DB.set(Mutex::new(conn));
    }
    Ok(DB.get().expect("todo db was just set").lock().unwrap())
}

fn init_conn(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // Deleting a card from the archive means it is gone: overwrite the freed
    // pages (card text, attachment bytes) instead of leaving them in the file.
    conn.pragma_update(None, "secure_delete", "ON")?;
    // Rebuilding a table is only safe with foreign keys off, and the pragma
    // is ignored inside a transaction, so switch it off around the whole
    // migration run. `migrate` checks the constraints itself before each
    // commit, and they are always switched back on, even after a failure.
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let result = migrate(conn);
    conn.pragma_update(None, "foreign_keys", "ON")?;
    result
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, script) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version <= current {
            continue;
        }
        // Dropping the transaction without commit rolls the step back.
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(script)?;
        let broken: Option<String> = tx
            .query_row("PRAGMA foreign_key_check", [], |r| r.get(0))
            .optional()?;
        if let Some(table) = broken {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY),
                Some(format!("migration {version} broke a foreign key in {table}")),
            ));
        }
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

fn now() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn map_project(r: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get("id")?,
        name: r.get("name")?,
        color: r.get("color")?,
        archived: r.get::<_, i64>("archived")? != 0,
        sort: r.get("sort")?,
    })
}

fn map_column(r: &Row) -> rusqlite::Result<Column> {
    Ok(Column {
        id: r.get("id")?,
        name: r.get("name")?,
        color: r.get("color")?,
        done: r.get::<_, i64>("done")? != 0,
        sort: r.get("sort")?,
    })
}

fn map_task(r: &Row) -> rusqlite::Result<Task> {
    let mail_id: Option<String> = r.get("mail_id")?;
    let mail = match mail_id {
        Some(message_id) => Some(MailLink {
            account_id: r.get::<_, Option<String>>("mail_account")?.unwrap_or_default(),
            message_id,
            conversation_id: r.get("mail_conversation")?,
            subject: r.get::<_, Option<String>>("mail_subject")?.unwrap_or_default(),
            from: r.get::<_, Option<String>>("mail_from")?.unwrap_or_default(),
            address: r.get::<_, Option<String>>("mail_address")?.unwrap_or_default(),
        }),
        None => None,
    };
    Ok(Task {
        id: r.get("id")?,
        title: r.get("title")?,
        project_id: r.get("project_id")?,
        column_id: r.get("column_id")?,
        color: r.get("color")?,
        sort: r.get("sort")?,
        follow_up: r.get("follow_up")?,
        note: r.get("note")?,
        mail,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        done_at: r.get("done_at")?,
        archived_at: r.get("archived_at")?,
    })
}

const ATTACHMENT_META: &str = "SELECT id, task_id, name, mime, size, created_at FROM attachment";

fn map_attachment(r: &Row) -> rusqlite::Result<AttachmentMeta> {
    Ok(AttachmentMeta {
        id: r.get("id")?,
        task_id: r.get("task_id")?,
        name: r.get("name")?,
        mime: r.get("mime")?,
        size: r.get("size")?,
        created_at: r.get("created_at")?,
    })
}

fn load(conn: &Connection) -> rusqlite::Result<TodoData> {
    let projects = conn
        .prepare("SELECT * FROM project ORDER BY sort, id")?
        .query_map([], map_project)?
        .collect::<rusqlite::Result<_>>()?;
    let columns = conn
        .prepare("SELECT * FROM board_column ORDER BY sort, id")?
        .query_map([], map_column)?
        .collect::<rusqlite::Result<_>>()?;
    let tasks = conn
        .prepare("SELECT * FROM task ORDER BY column_id, sort, id")?
        .query_map([], map_task)?
        .collect::<rusqlite::Result<_>>()?;
    let attachments = conn
        .prepare(&format!("{ATTACHMENT_META} ORDER BY id"))?
        .query_map([], map_attachment)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(TodoData { projects, columns, tasks, attachments })
}

/// Trimmed name or label, refusing empty and overlong values.
fn clean_name(s: &str, what: &str) -> Result<String, String> {
    let s = s.trim();
    if s.is_empty() {
        return Err(format!("{what} mag niet leeg zijn."));
    }
    Ok(s.chars().take(200).collect())
}

/// A colour is optional; anything other than `#rrggbb` is dropped.
fn clean_color(s: &str) -> String {
    let s = s.trim();
    let ok = s.len() == 7
        && s.starts_with('#')
        && s[1..].chars().all(|c| c.is_ascii_hexdigit());
    if ok { s.to_string() } else { String::new() }
}

fn save_project(conn: &Connection, p: &ProjectInput) -> Result<Project, String> {
    let name = clean_name(&p.name, "De projectnaam")?;
    let color = clean_color(&p.color);
    let id = match p.id {
        Some(id) => {
            let n = conn
                .execute(
                    "UPDATE project SET name = ?1, color = ?2, archived = ?3 WHERE id = ?4",
                    params![name, color, p.archived as i64, id],
                )
                .map_err(err)?;
            if n == 0 {
                return Err("Dit project bestaat niet meer.".into());
            }
            id
        }
        None => {
            conn.execute(
                "INSERT INTO project (name, color, archived, sort, created_at)
                 VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM project), ?4)",
                params![name, color, p.archived as i64, now()],
            )
            .map_err(err)?;
            conn.last_insert_rowid()
        }
    };
    conn.query_row("SELECT * FROM project WHERE id = ?1", [id], map_project)
        .map_err(err)
}

// ---- Columns ----

/// The `done` flag of a column, or None when it does not exist.
fn column_done(conn: &Connection, id: i64) -> Result<Option<bool>, String> {
    conn.query_row("SELECT done FROM board_column WHERE id = ?1", [id], |r| {
        r.get::<_, i64>(0).map(|d| d != 0)
    })
    .optional()
    .map_err(err)
}

/// The leftmost column, optionally skipping one (the column being deleted).
fn first_column(conn: &Connection, except: Option<i64>) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM board_column WHERE id IS NOT ?1 ORDER BY sort, id LIMIT 1",
        [except],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}

/// Sort value that puts a card after every card already in the column.
fn append_sort(conn: &Connection, column_id: i64) -> Result<f64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort), 0) + 1 FROM task WHERE column_id = ?1",
        [column_id],
        |r| r.get(0),
    )
    .map_err(err)
}

fn save_column(conn: &Connection, c: &ColumnInput) -> Result<Column, String> {
    let name = clean_name(&c.name, "De kolomnaam")?;
    let color = clean_color(&c.color);
    let tx = conn.unchecked_transaction().map_err(err)?;
    let id = match c.id {
        Some(id) => {
            let Some(was_done) = column_done(&tx, id)? else {
                return Err("Deze kolom bestaat niet meer.".into());
            };
            tx.execute(
                "UPDATE board_column SET name = ?1, color = ?2, done = ?3 WHERE id = ?4",
                params![name, color, c.done as i64, id],
            )
            .map_err(err)?;
            // Keep `doneAt` in line with the column the cards are in.
            if c.done && !was_done {
                tx.execute(
                    "UPDATE task SET done_at = ?1 WHERE column_id = ?2 AND done_at IS NULL",
                    params![now(), id],
                )
                .map_err(err)?;
            } else if !c.done && was_done {
                tx.execute("UPDATE task SET done_at = NULL WHERE column_id = ?1", [id])
                    .map_err(err)?;
            }
            id
        }
        None => {
            tx.execute(
                "INSERT INTO board_column (name, color, done, sort)
                 VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM board_column))",
                params![name, color, c.done as i64],
            )
            .map_err(err)?;
            tx.last_insert_rowid()
        }
    };
    let column = tx
        .query_row("SELECT * FROM board_column WHERE id = ?1", [id], map_column)
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(column)
}

/// Deletes a column. A column that still holds cards (in any project) is only
/// deleted together with an explicit `move_to` column: its cards go to the
/// end of that column, so no card is ever left without a column.
fn delete_column(conn: &Connection, id: i64, move_to: Option<i64>) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let Some(was_done) = column_done(&tx, id)? else {
        return Ok(());
    };
    if first_column(&tx, Some(id))?.is_none() {
        return Err("De laatste kolom kan niet worden verwijderd.".into());
    }
    let cards: Vec<i64> = tx
        .prepare("SELECT id FROM task WHERE column_id = ?1 ORDER BY sort, id")
        .and_then(|mut s| s.query_map([id], |r| r.get(0))?.collect())
        .map_err(err)?;
    if cards.is_empty() {
        tx.execute("DELETE FROM board_column WHERE id = ?1", [id]).map_err(err)?;
        return tx.commit().map_err(err);
    }
    let target = match move_to {
        Some(t) if t != id => t,
        _ => {
            return Err(format!(
                "Er staan nog {} kaart(en) in deze kolom. Kies eerst naar welke kolom ze gaan.",
                cards.len()
            ))
        }
    };
    let Some(target_done) = column_done(&tx, target)? else {
        return Err("De gekozen kolom bestaat niet meer.".into());
    };
    let base = append_sort(&tx, target)?;
    let stamp = now();
    // Same `doneAt` rule as when a single card changes column.
    let done_sql = match (was_done, target_done) {
        (_, false) => "NULL",
        (true, true) => "COALESCE(done_at, ?3)",
        (false, true) => "?3",
    };
    for (i, card) in cards.iter().enumerate() {
        tx.execute(
            &format!(
                "UPDATE task SET column_id = ?1, sort = ?2, done_at = {done_sql},
                    updated_at = ?3 WHERE id = ?4"
            ),
            params![target, base + i as f64, stamp, card],
        )
        .map_err(err)?;
    }
    tx.execute("DELETE FROM board_column WHERE id = ?1", [id]).map_err(err)?;
    tx.commit().map_err(err)
}

// ---- Tasks ----

fn save_task(conn: &Connection, t: &TaskInput) -> Result<Task, String> {
    let title = clean_name(&t.title, "De titel")?;
    let color = clean_color(&t.color);
    let follow_up = match t.follow_up.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(d) => {
            chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| format!("Ongeldige datum: {d}"))?;
            Some(d.to_string())
        }
    };
    if t.sort.is_some_and(|s| !s.is_finite()) {
        return Err("Ongeldige positie voor de taak.".into());
    }
    let column_id = match t.column_id {
        Some(id) => id,
        None => first_column(conn, None)?.ok_or("Er is geen kolom om de taak in te zetten.")?,
    };
    let Some(in_done) = column_done(conn, column_id)? else {
        return Err("Deze kolom bestaat niet meer.".into());
    };
    let mail = t.mail.as_ref();
    let stamp = now();
    let id = match t.id {
        Some(id) => {
            let before: Option<(i64, f64, Option<String>)> = conn
                .query_row(
                    "SELECT column_id, sort, done_at FROM task WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(err)?;
            let Some((old_column, old_sort, old_done)) = before else {
                return Err("Deze taak bestaat niet meer.".into());
            };
            let sort = match t.sort {
                Some(s) => s,
                None if old_column == column_id => old_sort,
                None => append_sort(conn, column_id)?,
            };
            // Keep the original completion moment while a card stays done.
            let was_done = column_done(conn, old_column)?.unwrap_or(false);
            let done_at = match (in_done, was_done) {
                (true, true) => old_done.or_else(|| Some(stamp.clone())),
                (true, false) => Some(stamp.clone()),
                (false, _) => None,
            };
            conn.execute(
                "UPDATE task SET title = ?1, project_id = ?2, column_id = ?3, color = ?4,
                    sort = ?5, follow_up = ?6, note = ?7, mail_account = ?8, mail_id = ?9,
                    mail_conversation = ?10, mail_subject = ?11, mail_from = ?12,
                    mail_address = ?13, updated_at = ?14, done_at = ?15
                 WHERE id = ?16",
                params![
                    title,
                    t.project_id,
                    column_id,
                    color,
                    sort,
                    follow_up,
                    t.note,
                    mail.map(|m| &m.account_id),
                    mail.map(|m| &m.message_id),
                    mail.and_then(|m| m.conversation_id.as_ref()),
                    mail.map(|m| &m.subject),
                    mail.map(|m| &m.from),
                    mail.map(|m| &m.address),
                    stamp,
                    done_at,
                    id
                ],
            )
            .map_err(err)?;
            id
        }
        None => {
            let sort = match t.sort {
                Some(s) => s,
                None => append_sort(conn, column_id)?,
            };
            let done_at = in_done.then(|| stamp.clone());
            conn.execute(
                "INSERT INTO task (title, project_id, column_id, color, sort, follow_up, note,
                    mail_account, mail_id, mail_conversation, mail_subject, mail_from,
                    mail_address, created_at, updated_at, done_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15)",
                params![
                    title,
                    t.project_id,
                    column_id,
                    color,
                    sort,
                    follow_up,
                    t.note,
                    mail.map(|m| &m.account_id),
                    mail.map(|m| &m.message_id),
                    mail.and_then(|m| m.conversation_id.as_ref()),
                    mail.map(|m| &m.subject),
                    mail.map(|m| &m.from),
                    mail.map(|m| &m.address),
                    stamp,
                    done_at
                ],
            )
            .map_err(err)?;
            conn.last_insert_rowid()
        }
    };
    conn.query_row("SELECT * FROM task WHERE id = ?1", [id], map_task)
        .map_err(err)
}

/// Puts a card in the archive by hand, or takes it out again. Archiving a
/// card that is already archived keeps the original moment.
fn archive_task(conn: &Connection, id: i64, archived: bool) -> Result<Task, String> {
    let changed = if archived {
        conn.execute(
            "UPDATE task SET archived_at = COALESCE(archived_at, ?1), updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
    } else {
        conn.execute(
            "UPDATE task SET archived_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
    }
    .map_err(err)?;
    if changed == 0 {
        return Err("Deze taak bestaat niet meer.".into());
    }
    conn.query_row("SELECT * FROM task WHERE id = ?1", [id], map_task)
        .map_err(err)
}

/// After deleting cards or attachments: secure_delete zeroes the freed pages
/// in the database, but in WAL mode older copies of those pages can still sit
/// in `todo.db-wal` until it is overwritten. A TRUNCATE checkpoint writes
/// the log back and empties the file, so deleted data is really gone. A busy
/// checkpoint only delays that, so it never fails the delete itself.
fn purge_wal(conn: &Connection) {
    let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
}

/// Deletes several cards at once (emptying the archive), all or none.
/// Their attachments go with them (ON DELETE CASCADE).
fn delete_tasks(conn: &mut Connection, ids: &[i64]) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    {
        let mut stmt = tx.prepare("DELETE FROM task WHERE id = ?1").map_err(err)?;
        for id in ids {
            stmt.execute([id]).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

fn reorder(conn: &mut Connection, kind: &str, ids: &[i64]) -> Result<(), String> {
    // Whitelist: the table name ends up in the SQL text.
    let table = match kind {
        "project" => "project",
        "column" => "board_column",
        _ => return Err(format!("Onbekende lijst: {kind}")),
    };
    let tx = conn.transaction().map_err(err)?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            &format!("UPDATE {table} SET sort = ?1 WHERE id = ?2"),
            params![(i + 1) as i64, id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

/// `table` is always a literal from this file, never user input.
fn delete(conn: &Connection, table: &str, id: i64) -> Result<(), String> {
    conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
        .map(|_| ())
        .map_err(err)
}

// ---- Attachments ----

/// A plain file name: no path separators or characters Windows refuses, at
/// most 200 characters (the extension survives the cut), never empty.
fn clean_file_name(raw: &str) -> String {
    let name = crate::download::sanitize_filename(raw);
    let cut = if name.chars().count() <= 200 {
        name
    } else {
        match name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && ext.chars().count() <= 20 => {
                let keep = 200 - 1 - ext.chars().count();
                format!("{}.{ext}", stem.chars().take(keep).collect::<String>())
            }
            _ => name.chars().take(200).collect(),
        }
    };
    // Windows drops trailing dots and spaces, which could hide the real
    // extension from `is_blocked`.
    let cut = cut.trim_end_matches(['.', ' ']);
    if cut.is_empty() { "bijlage".into() } else { cut.to_string() }
}

/// Keeps only a plausible `type/subtype` (parameters dropped), else "".
fn clean_mime(raw: &str) -> String {
    let base = raw.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let token = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && s.chars().all(|c| c.is_ascii_alphanumeric() || "!#$&^_.+-".contains(c))
    };
    match base.split_once('/') {
        Some((t, s)) if token(t) && token(s) => base,
        _ => String::new(),
    }
}

/// True when opening the file with its default app would run code.
fn is_blocked(name: &str) -> bool {
    let name = name.trim_end_matches(['.', ' ']);
    match name.rsplit_once('.') {
        Some((_, ext)) => BLOCKED_EXTENSIONS.iter().any(|b| b.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

fn add_attachment(
    conn: &Connection,
    task_id: i64,
    name: &str,
    mime: &str,
    data: &[u8],
) -> Result<AttachmentMeta, String> {
    if data.is_empty() {
        return Err("Het bestand is leeg.".into());
    }
    if data.len() > MAX_ATTACHMENT {
        return Err(format!(
            "Het bestand is te groot: een bijlage mag maximaal {} MB zijn.",
            MAX_ATTACHMENT / (1024 * 1024)
        ));
    }
    let exists: bool = conn
        .query_row("SELECT 1 FROM task WHERE id = ?1", [task_id], |_| Ok(()))
        .optional()
        .map_err(err)?
        .is_some();
    if !exists {
        return Err("Deze taak bestaat niet meer.".into());
    }
    conn.execute(
        "INSERT INTO attachment (task_id, name, mime, size, data, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![task_id, clean_file_name(name), clean_mime(mime), data.len() as i64, data, now()],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    conn.query_row(&format!("{ATTACHMENT_META} WHERE id = ?1"), [id], map_attachment)
        .map_err(err)
}

/// Name and bytes of an attachment.
fn attachment_data(conn: &Connection, id: i64) -> Result<(String, Vec<u8>), String> {
    conn.query_row("SELECT name, data FROM attachment WHERE id = ?1", [id], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })
    .optional()
    .map_err(err)?
    .ok_or_else(|| "Deze bijlage bestaat niet meer.".into())
}

fn open() -> Result<MutexGuard<'static, Connection>, String> {
    db().map_err(|e| format!("{e:#}"))
}

// ---- Tauri commands ----

#[tauri::command]
pub fn todo_load() -> Result<TodoData, String> {
    load(&*open()?).map_err(err)
}

#[tauri::command]
pub fn todo_save_project(project: ProjectInput) -> Result<Project, String> {
    save_project(&*open()?, &project)
}

/// Deletes a project; its tasks move to the Inbox (ON DELETE SET NULL).
#[tauri::command]
pub fn todo_delete_project(id: i64) -> Result<(), String> {
    delete(&*open()?, "project", id)
}

#[tauri::command]
pub fn todo_save_column(column: ColumnInput) -> Result<Column, String> {
    save_column(&*open()?, &column)
}

/// Deletes a column; its cards move to the end of the first remaining one.
#[tauri::command]
pub fn todo_delete_column(id: i64, move_to: Option<i64>) -> Result<(), String> {
    delete_column(&*open()?, id, move_to)
}

/// New order of the projects or columns (`kind` = "project" | "column").
#[tauri::command]
pub fn todo_reorder(kind: String, ids: Vec<i64>) -> Result<(), String> {
    reorder(&mut *open()?, &kind, &ids)
}

#[tauri::command]
pub fn todo_save_task(task: TaskInput) -> Result<Task, String> {
    save_task(&*open()?, &task)
}

/// Deletes a task; its attachments go with it (ON DELETE CASCADE).
#[tauri::command]
pub fn todo_delete_task(id: i64) -> Result<(), String> {
    let conn = open()?;
    delete(&conn, "task", id)?;
    purge_wal(&conn);
    Ok(())
}

#[tauri::command]
pub fn todo_delete_tasks(ids: Vec<i64>) -> Result<(), String> {
    let mut conn = open()?;
    delete_tasks(&mut conn, &ids)?;
    purge_wal(&conn);
    Ok(())
}

#[tauri::command]
pub fn todo_archive_task(id: i64, archived: bool) -> Result<Task, String> {
    archive_task(&*open()?, id, archived)
}

/// Stores an attachment. The body is the raw file (no JSON round trip for
/// megabytes of bytes); task id, name and type travel as headers:
/// `x-task-id`, `x-name` (percent-encoded) and `x-mime`.
#[tauri::command]
pub fn todo_add_attachment(request: tauri::ipc::Request<'_>) -> Result<AttachmentMeta, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("De bijlage moet als bestand worden meegestuurd.".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let task_id: i64 = header("x-task-id")
        .and_then(|v| v.trim().parse().ok())
        .ok_or("Onbekende taak voor de bijlage.")?;
    let name = percent_encoding::percent_decode_str(header("x-name").unwrap_or(""))
        .decode_utf8_lossy()
        .into_owned();
    let mime = header("x-mime").unwrap_or("");
    add_attachment(&*open()?, task_id, &name, mime, data)
}

/// The bytes of an attachment, delivered to JS as an ArrayBuffer.
#[tauri::command]
pub fn todo_attachment_data(id: i64) -> Result<tauri::ipc::Response, String> {
    let (_, data) = attachment_data(&*open()?, id)?;
    Ok(tauri::ipc::Response::new(data))
}

/// Writes the attachment to a temp folder and opens it with the default app.
#[tauri::command]
pub fn todo_open_attachment(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // The guard is a temporary, so the lock is released before any file I/O.
    let (name, data) = attachment_data(&*open()?, id)?;
    let name = clean_file_name(&name);
    if is_blocked(&name) {
        return Err(
            "Dit type bestand kan programmacode uitvoeren en wordt daarom niet geopend. \
             Sla het op in Downloads als je het toch nodig hebt."
                .into(),
        );
    }
    let dir = std::env::temp_dir().join("BE-Mail").join("todo").join(id.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| format!("Kon de tijdelijke map niet aanmaken: {e}"))?;
    let path = dir.join(&name);
    // Still open in another program from an earlier click: that copy is the
    // same attachment, so opening it again is fine.
    if let Err(e) = std::fs::write(&path, &data) {
        if !path.exists() {
            return Err(format!("Kon de bijlage niet wegschrijven: {e}"));
        }
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Kon de bijlage niet openen: {e}"))
}

/// Saves the attachment to Downloads and returns the full path.
#[tauri::command]
pub fn todo_save_attachment(id: i64) -> Result<String, String> {
    let (name, data) = attachment_data(&*open()?, id)?;
    crate::download::save_to_downloads(&name, &data).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn todo_delete_attachment(id: i64) -> Result<(), String> {
    let conn = open()?;
    delete(&conn, "attachment", id)?;
    purge_wal(&conn);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_conn(&conn).unwrap();
        conn
    }

    fn task(title: &str) -> TaskInput {
        TaskInput {
            id: None,
            title: title.into(),
            project_id: None,
            column_id: None,
            color: String::new(),
            sort: None,
            follow_up: None,
            note: String::new(),
            mail: None,
        }
    }

    fn column_id(conn: &Connection, name: &str) -> i64 {
        load(conn).unwrap().columns.into_iter().find(|c| c.name == name).unwrap().id
    }

    fn update(t: &Task) -> TaskInput {
        TaskInput {
            id: Some(t.id),
            column_id: Some(t.column_id),
            ..task(&t.title)
        }
    }

    #[test]
    fn migrates_a_version_1_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute_batch(
            "INSERT INTO project (id, name, color, archived, sort, created_at)
                VALUES (7, 'Klant X', '#ff0000', 0, 1, '2026-01-01');
             INSERT INTO task (id, title, project_id, status, action_id, note, mail_id,
                    mail_subject, created_at, updated_at, done_at) VALUES
                (1, 'Open', 7, 'todo', 1, 'notitie', 'msg', 'Offerte', 'c', 'u1', NULL),
                (2, 'Bezig', NULL, 'doing', NULL, '', NULL, NULL, 'c', 'u2', NULL),
                (3, 'Af', 7, 'done', 4, '', NULL, NULL, 'c', 'u3', 'd3'),
                (4, 'Af zonder datum', NULL, 'done', NULL, '', NULL, NULL, 'c', 'u4', NULL),
                (5, 'Ook open', NULL, 'todo', NULL, '', NULL, NULL, 'c', 'u5', NULL);",
        )
        .unwrap();
        init_conn(&conn).unwrap();

        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        let action: Option<String> = conn
            .query_row("SELECT name FROM sqlite_master WHERE name = 'action'", [], |r| r.get(0))
            .optional()
            .unwrap();
        assert!(action.is_none());

        let data = load(&conn).unwrap();
        assert_eq!(data.projects.len(), 1);
        let by_id = |id: i64| data.tasks.iter().find(|t| t.id == id).unwrap();
        let todo = column_id(&conn, "Te doen");
        let doing = column_id(&conn, "Bezig");
        let done = column_id(&conn, "Klaar");
        assert_eq!(by_id(1).column_id, todo);
        assert_eq!(by_id(5).column_id, todo);
        assert_eq!(by_id(2).column_id, doing);
        assert_eq!(by_id(3).column_id, done);
        assert_eq!(by_id(4).column_id, done);
        assert_eq!(by_id(1).project_id, Some(7));
        assert_eq!(by_id(1).note, "notitie");
        assert_eq!(by_id(1).mail.as_ref().unwrap().subject, "Offerte");
        assert_eq!(by_id(1).sort, 1.0);
        assert_eq!(by_id(5).sort, 5.0);
        assert_eq!(by_id(3).done_at.as_deref(), Some("d3"));
        assert_eq!(by_id(4).done_at.as_deref(), Some("u4"));
        assert!(by_id(1).done_at.is_none());
        // Tasks come back grouped per column, in their old order.
        let order: Vec<i64> = data.tasks.iter().map(|t| t.id).collect();
        assert_eq!(order, [1, 5, 2, 3, 4]);

        // The rebuilt table still enforces its foreign keys.
        assert!(conn
            .execute("UPDATE task SET column_id = 999 WHERE id = 1", [])
            .is_err());
        delete(&conn, "project", 7).unwrap();
        assert!(load(&conn).unwrap().tasks.iter().all(|t| t.project_id.is_none()));
        // And it is idempotent.
        init_conn(&conn).unwrap();
    }

    #[test]
    fn fresh_database_has_the_seeded_columns() {
        let conn = mem();
        let cols = load(&conn).unwrap().columns;
        let names: Vec<_> = cols.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Te doen", "Bezig", "Wacht op klant", "Klaar"]);
        assert_eq!(cols.iter().filter(|c| c.done).map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Klaar"]);
        assert_eq!(cols.iter().map(|c| c.sort).collect::<Vec<_>>(), [1, 2, 3, 4]);
        // Without a column a new card lands in the first one.
        let t = save_task(&conn, &task("x")).unwrap();
        assert_eq!(t.column_id, cols[0].id);
    }

    #[test]
    fn done_at_follows_done_columns() {
        let conn = mem();
        let todo = column_id(&conn, "Te doen");
        let done = column_id(&conn, "Klaar");
        let t = save_task(&conn, &task("DNS checken")).unwrap();
        assert!(t.done_at.is_none());
        let mut input = update(&t);
        input.column_id = Some(done);
        let finished = save_task(&conn, &input).unwrap();
        assert!(finished.done_at.is_some());
        // Saving again while done keeps the original moment.
        let again = save_task(&conn, &input).unwrap();
        assert_eq!(again.done_at, finished.done_at);
        // Moving to another done column keeps it too.
        let archive = save_column(
            &conn,
            &ColumnInput { id: None, name: "Archief".into(), color: String::new(), done: true },
        )
        .unwrap();
        input.column_id = Some(archive.id);
        assert_eq!(save_task(&conn, &input).unwrap().done_at, finished.done_at);
        input.column_id = Some(todo);
        assert!(save_task(&conn, &input).unwrap().done_at.is_none());
        // Inserting straight into a done column sets it.
        let mut direct = task("Al af");
        direct.column_id = Some(done);
        assert!(save_task(&conn, &direct).unwrap().done_at.is_some());
        // Turning a column into a done column stamps its cards, and back.
        let bezig = column_id(&conn, "Bezig");
        let mut busy = task("Bezig ermee");
        busy.column_id = Some(bezig);
        let b = save_task(&conn, &busy).unwrap();
        let col = |done| ColumnInput { id: Some(bezig), name: "Bezig".into(), color: String::new(), done };
        save_column(&conn, &col(true)).unwrap();
        let reload = |id| load(&conn).unwrap().tasks.into_iter().find(|t| t.id == id).unwrap();
        assert!(reload(b.id).done_at.is_some());
        save_column(&conn, &col(false)).unwrap();
        assert!(reload(b.id).done_at.is_none());
    }

    #[test]
    fn sort_append_rules() {
        let conn = mem();
        let todo = column_id(&conn, "Te doen");
        let doing = column_id(&conn, "Bezig");
        let a = save_task(&conn, &task("a")).unwrap();
        let b = save_task(&conn, &task("b")).unwrap();
        assert_eq!((a.sort, b.sort), (1.0, 2.0));
        // First card in an empty column gets 1.
        let mut c_in = task("c");
        c_in.column_id = Some(doing);
        let c = save_task(&conn, &c_in).unwrap();
        assert_eq!(c.sort, 1.0);
        // Update without sort in the same column keeps the position.
        let mut a_up = update(&a);
        a_up.title = "a2".into();
        assert_eq!(save_task(&conn, &a_up).unwrap().sort, 1.0);
        // Moving without sort appends at the end of the new column.
        a_up.column_id = Some(doing);
        let moved = save_task(&conn, &a_up).unwrap();
        assert_eq!((moved.column_id, moved.sort), (doing, 2.0));
        // An explicit sort is used as given, also between two cards.
        let mut b_up = update(&b);
        b_up.column_id = Some(doing);
        b_up.sort = Some(1.5);
        assert_eq!(save_task(&conn, &b_up).unwrap().sort, 1.5);
        let order: Vec<_> = load(&conn)
            .unwrap()
            .tasks
            .into_iter()
            .filter(|t| t.column_id == doing)
            .map(|t| t.title)
            .collect();
        assert_eq!(order, ["c", "b", "a2"]);
        let mut explicit = task("d");
        explicit.column_id = Some(todo);
        explicit.sort = Some(0.25);
        assert_eq!(save_task(&conn, &explicit).unwrap().sort, 0.25);
    }

    #[test]
    fn deleting_a_column_moves_its_cards() {
        let conn = mem();
        let todo = column_id(&conn, "Te doen");
        let doing = column_id(&conn, "Bezig");
        let done = column_id(&conn, "Klaar");
        save_task(&conn, &task("blijft")).unwrap();
        let mut x = task("x");
        x.column_id = Some(done);
        let x = save_task(&conn, &x).unwrap();
        let mut y = task("y");
        y.column_id = Some(done);
        save_task(&conn, &y).unwrap();
        // Cards in the column: refused without a target, or with itself as target.
        assert!(delete_column(&conn, done, None).is_err());
        assert!(delete_column(&conn, done, Some(done)).is_err());
        assert!(delete_column(&conn, done, Some(999)).is_err());
        assert_eq!(load(&conn).unwrap().columns.len(), 4);
        delete_column(&conn, done, Some(todo)).unwrap();
        let data = load(&conn).unwrap();
        assert_eq!(data.columns.len(), 3);
        let titles: Vec<_> = data.tasks.iter().map(|t| (t.title.as_str(), t.column_id, t.sort)).collect();
        assert_eq!(titles, [("blijft", todo, 1.0), ("x", todo, 2.0), ("y", todo, 3.0)]);
        // They left a done column for a not-done one.
        assert!(data.tasks.iter().all(|t| t.done_at.is_none()));
        assert!(x.done_at.is_some());
        // The cards go where the user says, not to the first column.
        let waiting = column_id(&conn, "Wacht op klant");
        delete_column(&conn, todo, Some(waiting)).unwrap();
        assert!(load(&conn).unwrap().tasks.iter().all(|t| t.column_id == waiting));
        // An empty column needs no target.
        delete_column(&conn, doing, None).unwrap();
        // The last column stays, even with a target.
        assert!(delete_column(&conn, waiting, None).is_err());
        assert_eq!(load(&conn).unwrap().columns.len(), 1);
        // An unknown column is a no-op, like other deletes.
        delete_column(&conn, 999, None).unwrap();
    }

    #[test]
    fn columns_save_and_reorder() {
        let mut conn = mem();
        let c = save_column(
            &conn,
            &ColumnInput { id: None, name: "  Review ".into(), color: "blauw".into(), done: false },
        )
        .unwrap();
        assert_eq!((c.name.as_str(), c.color.as_str(), c.sort), ("Review", "", 5));
        let ids: Vec<i64> = load(&conn).unwrap().columns.iter().rev().map(|c| c.id).collect();
        reorder(&mut conn, "column", &ids).unwrap();
        assert_eq!(load(&conn).unwrap().columns[0].name, "Review");
        let renamed = save_column(
            &conn,
            &ColumnInput { id: Some(c.id), name: "Controle".into(), color: "#00ff00".into(), done: false },
        )
        .unwrap();
        assert_eq!((renamed.name.as_str(), renamed.color.as_str()), ("Controle", "#00ff00"));
        assert!(save_column(
            &conn,
            &ColumnInput { id: Some(999), name: "x".into(), color: String::new(), done: false }
        )
        .is_err());
        assert!(save_column(
            &conn,
            &ColumnInput { id: None, name: " ".into(), color: String::new(), done: false }
        )
        .is_err());
    }

    #[test]
    fn rejects_bad_input() {
        let conn = mem();
        assert!(save_task(&conn, &task("   ")).is_err());
        let mut bad_column = task("x");
        bad_column.column_id = Some(999);
        assert!(save_task(&conn, &bad_column).is_err());
        let mut bad_date = task("x");
        bad_date.follow_up = Some("vrijdag".into());
        assert!(save_task(&conn, &bad_date).is_err());
        let mut bad_sort = task("x");
        bad_sort.sort = Some(f64::NAN);
        assert!(save_task(&conn, &bad_sort).is_err());
        let mut no_task = task("x");
        no_task.id = Some(999);
        assert!(save_task(&conn, &no_task).is_err());
        let mut colored = task("x");
        colored.color = "#ABCDEF".into();
        assert_eq!(save_task(&conn, &colored).unwrap().color, "#ABCDEF");
        colored.color = "rood".into();
        assert_eq!(save_task(&conn, &colored).unwrap().color, "");
    }

    #[test]
    fn task_input_deserializes_with_defaults() {
        let t: TaskInput =
            serde_json::from_str(r#"{"title":"x","projectId":null,"columnId":null}"#).unwrap();
        assert!(t.id.is_none() && t.column_id.is_none() && t.sort.is_none());
        assert_eq!((t.color.as_str(), t.note.as_str()), ("", ""));
        let full: TaskInput = serde_json::from_str(
            r##"{"id":3,"title":"x","projectId":2,"columnId":4,"color":"#123456","sort":1.5,
                "followUp":"2026-12-01","note":"n","mail":null}"##,
        )
        .unwrap();
        assert_eq!((full.column_id, full.sort), (Some(4), Some(1.5)));
        let json = serde_json::to_value(save_task(&mem(), &task("y")).unwrap()).unwrap();
        for key in ["projectId", "columnId", "followUp", "createdAt", "updatedAt", "doneAt"] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
    }

    #[test]
    fn mail_link_round_trips() {
        let conn = mem();
        let mut input = task("Offerte beantwoorden");
        input.mail = Some(MailLink {
            account_id: "acc".into(),
            message_id: "msg".into(),
            conversation_id: Some("conv".into()),
            subject: "Offerte".into(),
            from: "Klant".into(),
            address: "klant@example.com".into(),
        });
        let t = save_task(&conn, &input).unwrap();
        assert_eq!(t.mail, input.mail);
        assert!(save_task(&conn, &task("zonder mail")).unwrap().mail.is_none());
    }

    #[test]
    fn archive_by_hand_and_back() {
        let conn = mem();
        let t = save_task(&conn, &task("Kaart")).unwrap();
        assert_eq!(t.archived_at, None);
        let a = archive_task(&conn, t.id, true).unwrap();
        let first = a.archived_at.clone().expect("archived");
        // Archiving again keeps the first moment.
        let again = archive_task(&conn, t.id, true).unwrap();
        assert_eq!(again.archived_at.as_deref(), Some(first.as_str()));
        // A normal save (patchTask) leaves the archive mark alone.
        let saved = save_task(&conn, &update(&again)).unwrap();
        assert_eq!(saved.archived_at.as_deref(), Some(first.as_str()));
        let back = archive_task(&conn, t.id, false).unwrap();
        assert_eq!(back.archived_at, None);
        assert!(archive_task(&conn, 9999, true).is_err());
    }

    #[test]
    fn deleting_several_tasks_takes_their_attachments() {
        let mut conn = mem();
        let a = save_task(&conn, &task("A")).unwrap();
        let b = save_task(&conn, &task("B")).unwrap();
        let c = save_task(&conn, &task("C")).unwrap();
        add_attachment(&conn, a.id, "a.txt", "text/plain", b"hallo").unwrap();
        delete_tasks(&mut conn, &[a.id, b.id]).unwrap();
        purge_wal(&conn);
        let data = load(&conn).unwrap();
        assert_eq!(data.tasks.iter().map(|t| t.id).collect::<Vec<_>>(), vec![c.id]);
        assert!(data.attachments.is_empty());
    }

    #[test]
    fn deleting_a_project_keeps_its_tasks() {
        let conn = mem();
        let p = save_project(
            &conn,
            &ProjectInput { id: None, name: "Klant X".into(), color: "#ff0000".into(), archived: false },
        )
        .unwrap();
        let mut input = task("Live zetten");
        input.project_id = Some(p.id);
        let t = save_task(&conn, &input).unwrap();
        delete(&conn, "project", p.id).unwrap();
        let after = load(&conn).unwrap();
        assert_eq!(after.tasks.iter().find(|x| x.id == t.id).unwrap().project_id, None);
    }

    #[test]
    fn reorder_and_colors() {
        let mut conn = mem();
        let a = save_project(
            &conn,
            &ProjectInput { id: None, name: "A".into(), color: "red".into(), archived: false },
        )
        .unwrap();
        assert_eq!(a.color, "");
        let b = save_project(
            &conn,
            &ProjectInput { id: None, name: "B".into(), color: String::new(), archived: false },
        )
        .unwrap();
        reorder(&mut conn, "project", &[b.id, a.id]).unwrap();
        let names: Vec<_> = load(&conn).unwrap().projects.into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["B", "A"]);
        assert!(reorder(&mut conn, "action", &[1]).is_err());
        assert!(reorder(&mut conn, "task; DROP TABLE task", &[1]).is_err());
    }

    #[test]
    fn attachments_store_and_cascade() {
        let conn = mem();
        let t = save_task(&conn, &task("Screenshot bekijken")).unwrap();
        let meta = add_attachment(&conn, t.id, "map/scherm.png", "image/png", b"\x89PNG").unwrap();
        assert_eq!(
            (meta.task_id, meta.name.as_str(), meta.mime.as_str(), meta.size),
            (t.id, "map_scherm.png", "image/png", 4)
        );
        assert_eq!(attachment_data(&conn, meta.id).unwrap().1, b"\x89PNG");
        let data = load(&conn).unwrap();
        assert_eq!(data.attachments, vec![meta.clone()]);
        // Metadata only: the bytes never go out with `todo_load`.
        assert!(serde_json::to_value(&data).unwrap()["attachments"][0].get("data").is_none());

        let other = add_attachment(&conn, t.id, "", "", b"x").unwrap();
        assert_eq!((other.name.as_str(), other.mime.as_str()), ("bijlage", ""));
        delete(&conn, "attachment", other.id).unwrap();
        assert!(attachment_data(&conn, other.id).is_err());

        delete(&conn, "task", t.id).unwrap();
        assert!(load(&conn).unwrap().attachments.is_empty());
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM attachment", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn attachments_reject_bad_input() {
        let conn = mem();
        let t = save_task(&conn, &task("x")).unwrap();
        assert!(add_attachment(&conn, t.id, "leeg.txt", "text/plain", b"").is_err());
        assert!(add_attachment(&conn, 999, "a.txt", "text/plain", b"x").is_err());
        let big = vec![0u8; MAX_ATTACHMENT + 1];
        let e = add_attachment(&conn, t.id, "groot.bin", "", &big).unwrap_err();
        assert!(e.contains("25 MB"), "{e}");
        assert!(add_attachment(&conn, t.id, "precies.bin", "", &big[..MAX_ATTACHMENT]).is_ok());
    }

    #[test]
    fn file_names_mime_and_blocked_types() {
        assert_eq!(clean_file_name("..\\..\\evil.txt"), "_.._evil.txt");
        assert_eq!(clean_file_name("  "), "bijlage");
        let long = format!("{}.pdf", "a".repeat(300));
        let cut = clean_file_name(&long);
        assert_eq!(cut.chars().count(), 200);
        assert!(cut.ends_with(".pdf"));

        assert_eq!(clean_mime("image/PNG"), "image/png");
        assert_eq!(clean_mime("text/plain; charset=utf-8"), "text/plain");
        assert_eq!(clean_mime("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assert_eq!(clean_mime("text"), "");
        assert_eq!(clean_mime("text/<script>"), "");
        assert_eq!(clean_mime("/plain"), "");

        assert!(is_blocked("setup.EXE"));
        assert!(is_blocked("run.ps1"));
        assert!(is_blocked("snelkoppeling.lnk"));
        assert!(is_blocked("x.exe. "));
        assert!(!is_blocked("scherm.png"));
        assert!(!is_blocked("exe"));
        assert!(!is_blocked("offerte.pdf"));
    }
}
