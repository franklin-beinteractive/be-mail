//! Personal task list ("Taken"): projects, tasks and the action labels that
//! say what the next step of a task is. This is primary data, so it lives in
//! its own SQLite file (`todo.db`) next to the throwaway mail cache. Nothing
//! here talks to Microsoft Graph; a task only remembers which mail it came
//! from so the frontend can open that mail again.

use std::sync::{Mutex, MutexGuard, OnceLock};

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

/// Migrations in order; `PRAGMA user_version` records how many have run.
const MIGRATIONS: &[&str] = &[r#"
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
"#];

const STATUSES: &[&str] = &["todo", "doing", "done"];

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: i64,
    pub label: String,
    /// The ball is with someone else: the task shows up under "Wachten".
    pub waiting: bool,
    pub color: String,
    pub sort: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInput {
    pub id: Option<i64>,
    pub label: String,
    #[serde(default)]
    pub waiting: bool,
    #[serde(default)]
    pub color: String,
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
    pub status: String,
    pub action_id: Option<i64>,
    /// Date (YYYY-MM-DD) on which to look at the task again.
    pub follow_up: Option<String>,
    pub note: String,
    pub mail: Option<MailLink>,
    pub created_at: String,
    pub updated_at: String,
    pub done_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: Option<i64>,
    pub title: String,
    pub project_id: Option<i64>,
    #[serde(default = "default_status")]
    pub status: String,
    pub action_id: Option<i64>,
    pub follow_up: Option<String>,
    #[serde(default)]
    pub note: String,
    pub mail: Option<MailLink>,
}

fn default_status() -> String {
    "todo".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoData {
    pub projects: Vec<Project>,
    pub actions: Vec<Action>,
    pub tasks: Vec<Task>,
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
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, script) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current {
            conn.execute_batch(&format!(
                "BEGIN; {script}; PRAGMA user_version = {version}; COMMIT;"
            ))?;
        }
    }
    Ok(())
}

fn now() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
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

fn map_action(r: &Row) -> rusqlite::Result<Action> {
    Ok(Action {
        id: r.get("id")?,
        label: r.get("label")?,
        waiting: r.get::<_, i64>("waiting")? != 0,
        color: r.get("color")?,
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
        status: r.get("status")?,
        action_id: r.get("action_id")?,
        follow_up: r.get("follow_up")?,
        note: r.get("note")?,
        mail,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        done_at: r.get("done_at")?,
    })
}

fn load(conn: &Connection) -> rusqlite::Result<TodoData> {
    let projects = conn
        .prepare("SELECT * FROM project ORDER BY sort, id")?
        .query_map([], map_project)?
        .collect::<rusqlite::Result<_>>()?;
    let actions = conn
        .prepare("SELECT * FROM action ORDER BY sort, id")?
        .query_map([], map_action)?
        .collect::<rusqlite::Result<_>>()?;
    let tasks = conn
        .prepare("SELECT * FROM task ORDER BY id")?
        .query_map([], map_task)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(TodoData { projects, actions, tasks })
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
                .map_err(|e| e.to_string())?;
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
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    conn.query_row("SELECT * FROM project WHERE id = ?1", [id], map_project)
        .map_err(|e| e.to_string())
}

fn save_action(conn: &Connection, a: &ActionInput) -> Result<Action, String> {
    let label = clean_name(&a.label, "De naam van de actie")?;
    let color = clean_color(&a.color);
    let id = match a.id {
        Some(id) => {
            let n = conn
                .execute(
                    "UPDATE action SET label = ?1, waiting = ?2, color = ?3 WHERE id = ?4",
                    params![label, a.waiting as i64, color, id],
                )
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("Deze actie bestaat niet meer.".into());
            }
            id
        }
        None => {
            conn.execute(
                "INSERT INTO action (label, waiting, color, sort)
                 VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM action))",
                params![label, a.waiting as i64, color],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    conn.query_row("SELECT * FROM action WHERE id = ?1", [id], map_action)
        .map_err(|e| e.to_string())
}

fn save_task(conn: &Connection, t: &TaskInput) -> Result<Task, String> {
    let title = clean_name(&t.title, "De titel")?;
    if !STATUSES.contains(&t.status.as_str()) {
        return Err(format!("Onbekende status: {}", t.status));
    }
    let follow_up = match t.follow_up.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(d) => {
            chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| format!("Ongeldige datum: {d}"))?;
            Some(d.to_string())
        }
    };
    let mail = t.mail.as_ref();
    let stamp = now();
    let id = match t.id {
        Some(id) => {
            let before: Option<(String, Option<String>)> = conn
                .query_row(
                    "SELECT status, done_at FROM task WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let Some((old_status, old_done)) = before else {
                return Err("Deze taak bestaat niet meer.".into());
            };
            // Keep the original completion moment while a task stays done.
            let done_at = match (t.status.as_str(), old_status.as_str()) {
                ("done", "done") => old_done,
                ("done", _) => Some(stamp.clone()),
                _ => None,
            };
            conn.execute(
                "UPDATE task SET title = ?1, project_id = ?2, status = ?3, action_id = ?4,
                    follow_up = ?5, note = ?6, mail_account = ?7, mail_id = ?8,
                    mail_conversation = ?9, mail_subject = ?10, mail_from = ?11,
                    mail_address = ?12, updated_at = ?13, done_at = ?14
                 WHERE id = ?15",
                params![
                    title,
                    t.project_id,
                    t.status,
                    t.action_id,
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
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            let done_at = (t.status == "done").then(|| stamp.clone());
            conn.execute(
                "INSERT INTO task (title, project_id, status, action_id, follow_up, note,
                    mail_account, mail_id, mail_conversation, mail_subject, mail_from,
                    mail_address, created_at, updated_at, done_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14)",
                params![
                    title,
                    t.project_id,
                    t.status,
                    t.action_id,
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
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    conn.query_row("SELECT * FROM task WHERE id = ?1", [id], map_task)
        .map_err(|e| e.to_string())
}

fn reorder(conn: &mut Connection, kind: &str, ids: &[i64]) -> Result<(), String> {
    let table = match kind {
        "project" => "project",
        "action" => "action",
        _ => return Err(format!("Onbekende lijst: {kind}")),
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            &format!("UPDATE {table} SET sort = ?1 WHERE id = ?2"),
            params![(i + 1) as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn delete(conn: &Connection, table: &str, id: i64) -> Result<(), String> {
    conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn open() -> Result<MutexGuard<'static, Connection>, String> {
    db().map_err(|e| format!("{e:#}"))
}

// ---- Tauri commands ----

#[tauri::command]
pub fn todo_load() -> Result<TodoData, String> {
    load(&*open()?).map_err(|e| e.to_string())
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
pub fn todo_save_action(action: ActionInput) -> Result<Action, String> {
    save_action(&*open()?, &action)
}

/// Deletes an action label; tasks that had it keep going without one.
#[tauri::command]
pub fn todo_delete_action(id: i64) -> Result<(), String> {
    delete(&*open()?, "action", id)
}

/// New order of the projects or actions (`kind` = "project" | "action").
#[tauri::command]
pub fn todo_reorder(kind: String, ids: Vec<i64>) -> Result<(), String> {
    reorder(&mut *open()?, &kind, &ids)
}

#[tauri::command]
pub fn todo_save_task(task: TaskInput) -> Result<Task, String> {
    save_task(&*open()?, &task)
}

#[tauri::command]
pub fn todo_delete_task(id: i64) -> Result<(), String> {
    delete(&*open()?, "task", id)
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
            status: "todo".into(),
            action_id: None,
            follow_up: None,
            note: String::new(),
            mail: None,
        }
    }

    #[test]
    fn migration_seeds_actions_and_is_idempotent() {
        let conn = mem();
        init_conn(&conn).unwrap();
        let data = load(&conn).unwrap();
        assert_eq!(data.actions.len(), 5);
        assert_eq!(data.actions.iter().filter(|a| a.waiting).count(), 2);
    }

    #[test]
    fn done_at_follows_status() {
        let conn = mem();
        let t = save_task(&conn, &task("DNS checken")).unwrap();
        assert!(t.done_at.is_none());
        let mut input = task("DNS checken");
        input.id = Some(t.id);
        input.status = "done".into();
        let done = save_task(&conn, &input).unwrap();
        assert!(done.done_at.is_some());
        // Saving again while done keeps the original moment.
        let again = save_task(&conn, &input).unwrap();
        assert_eq!(again.done_at, done.done_at);
        input.status = "doing".into();
        assert!(save_task(&conn, &input).unwrap().done_at.is_none());
    }

    #[test]
    fn rejects_bad_input() {
        let conn = mem();
        assert!(save_task(&conn, &task("   ")).is_err());
        let mut bad = task("x");
        bad.status = "later".into();
        assert!(save_task(&conn, &bad).is_err());
        let mut bad_date = task("x");
        bad_date.follow_up = Some("vrijdag".into());
        assert!(save_task(&conn, &bad_date).is_err());
        let mut no_task = task("x");
        no_task.id = Some(999);
        assert!(save_task(&conn, &no_task).is_err());
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
    fn deleting_project_or_action_keeps_tasks() {
        let conn = mem();
        let p = save_project(
            &conn,
            &ProjectInput { id: None, name: "Klant X".into(), color: "#ff0000".into(), archived: false },
        )
        .unwrap();
        let a = load(&conn).unwrap().actions[0].clone();
        let mut input = task("Live zetten");
        input.project_id = Some(p.id);
        input.action_id = Some(a.id);
        let t = save_task(&conn, &input).unwrap();
        delete(&conn, "project", p.id).unwrap();
        delete(&conn, "action", a.id).unwrap();
        let after = load(&conn).unwrap();
        let kept = after.tasks.iter().find(|x| x.id == t.id).unwrap();
        assert_eq!(kept.project_id, None);
        assert_eq!(kept.action_id, None);
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
        assert!(reorder(&mut conn, "task; DROP TABLE task", &[1]).is_err());
    }
}
