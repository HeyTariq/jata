use rusqlite::Connection;
use std::path::Path;

pub type Result<T> = std::result::Result<T, rusqlite::Error>;

const MIGRATIONS: &[&str] = &[
    // 1: initial schema
    r#"
    CREATE TABLE projects (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        position    REAL    NOT NULL,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
    );

    CREATE TABLE todos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title       TEXT    NOT NULL,
        notes       TEXT    NOT NULL DEFAULT '',
        due_date    TEXT,
        position    REAL    NOT NULL,
        completed_at INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_todos_project ON todos(project_id, completed_at, position);
    CREATE INDEX idx_todos_due ON todos(due_date);

    CREATE TABLE tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL UNIQUE
    );

    CREATE TABLE todo_tags (
        todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
        PRIMARY KEY (todo_id, tag_id)
    );
    CREATE INDEX idx_todo_tags_tag ON todo_tags(tag_id);

    -- Append-only completion log. Rows keep a snapshot of the todo so that
    -- deleting a todo or renaming a project never rewrites past activity.
    CREATE TABLE activity (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        todo_id      INTEGER REFERENCES todos(id) ON DELETE SET NULL,
        title        TEXT    NOT NULL,
        project_name TEXT    NOT NULL,
        tags         TEXT    NOT NULL DEFAULT '',
        kind         TEXT    NOT NULL,
        at           INTEGER NOT NULL,
        local_date   TEXT    NOT NULL
    );
    CREATE INDEX idx_activity_local_date ON activity(local_date);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    INSERT INTO projects (name, position, is_default, created_at)
    VALUES ('Inbox', 1.0, 1, strftime('%s', 'now'));
    "#,
];

fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let target = i as i64 + 1;
        if version < target {
            conn.execute_batch(sql)?;
            conn.pragma_update(None, "user_version", target)?;
        }
    }
    Ok(())
}

fn prepare(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(conn)
}

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(path)?;
    prepare(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_memory() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate(&conn).expect("migrate");
    conn
}
