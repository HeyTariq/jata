use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, Result};
use crate::models::*;

/// Positions are floats so a drag writes exactly one row. When neighbours get
/// closer than this, the list is renormalized to whole numbers.
const MIN_GAP: f64 = 1e-6;

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Calendar date of `at` in a zone `tz_offset_minutes` behind UTC, matching
/// JavaScript's `Date.getTimezoneOffset()`.
pub fn local_date(at: i64, tz_offset_minutes: i32) -> String {
    let local = at - (tz_offset_minutes as i64) * 60;
    let days = local.div_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Howard Hinnant's days-from-civil inverse: turns a day number counted from
/// 1970-01-01 into (year, month, day).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------------------------------------------------------- projects

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.position, p.is_default,
                (SELECT COUNT(*) FROM todos t
                  WHERE t.project_id = p.id AND t.completed_at IS NULL)
         FROM projects p
         ORDER BY p.is_default DESC, p.position ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Project {
            id: r.get(0)?,
            name: r.get(1)?,
            position: r.get(2)?,
            is_default: r.get::<_, i64>(3)? != 0,
            open_count: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn default_project_id(conn: &Connection) -> Result<i64> {
    conn.query_row(
        "SELECT id FROM projects WHERE is_default = 1 ORDER BY id LIMIT 1",
        [],
        |r| r.get(0),
    )
    .map_err(Into::into)
}

pub fn create_project(conn: &Connection, name: &str) -> Result<i64> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("project name cannot be empty".into()));
    }
    let next: f64 = conn.query_row(
        "SELECT COALESCE(MAX(position), 0.0) + 1.0 FROM projects",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO projects (name, position, is_default, created_at) VALUES (?1, ?2, 0, ?3)",
        params![name, next, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_project(conn: &Connection, id: i64, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("project name cannot be empty".into()));
    }
    let n = conn.execute(
        "UPDATE projects SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    if n == 0 {
        return Err(AppError::NotFound("project"));
    }
    Ok(())
}

/// Deletes a project and moves its todos to the default list, so nothing is
/// silently lost. The default project itself cannot be deleted.
pub fn delete_project(conn: &mut Connection, id: i64) -> Result<()> {
    let is_default: Option<i64> = conn
        .query_row("SELECT is_default FROM projects WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .optional()?;
    match is_default {
        None => return Err(AppError::NotFound("project")),
        Some(1) => {
            return Err(AppError::Invalid(
                "the default list cannot be deleted".into(),
            ))
        }
        _ => {}
    }

    let fallback = default_project_id(conn)?;
    let tx = conn.transaction()?;
    let base: f64 = tx.query_row(
        "SELECT COALESCE(MAX(position), 0.0) FROM todos WHERE project_id = ?1",
        [fallback],
        |r| r.get(0),
    )?;
    tx.execute(
        "UPDATE todos
            SET project_id = ?2,
                position = ?3 + (
                    SELECT rn FROM (
                        SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rn
                          FROM todos WHERE project_id = ?1
                    ) ranked WHERE ranked.id = todos.id)
          WHERE project_id = ?1",
        params![id, fallback, base],
    )?;
    tx.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

// -------------------------------------------------------------------- tags

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT g.name,
                (SELECT COUNT(*) FROM todo_tags tt
                   JOIN todos t ON t.id = tt.todo_id
                  WHERE tt.tag_id = g.id AND t.completed_at IS NULL)
         FROM tags g
         ORDER BY g.name ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            name: r.get(0)?,
            open_count: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn normalize_tag(raw: &str) -> String {
    raw.trim().trim_start_matches('#').to_lowercase()
}

fn set_tags(conn: &Connection, todo_id: i64, tags: &[String]) -> Result<()> {
    conn.execute("DELETE FROM todo_tags WHERE todo_id = ?1", [todo_id])?;
    for raw in tags {
        let name = normalize_tag(raw);
        if name.is_empty() {
            continue;
        }
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&name])?;
        let tag_id: i64 = conn.query_row("SELECT id FROM tags WHERE name = ?1", [&name], |r| {
            r.get(0)
        })?;
        conn.execute(
            "INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?1, ?2)",
            params![todo_id, tag_id],
        )?;
    }
    // Drop tags that no todo references any more, so the sidebar stays clean.
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM todo_tags)",
        [],
    )?;
    Ok(())
}

fn tags_of(conn: &Connection, todo_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT g.name FROM todo_tags tt JOIN tags g ON g.id = tt.tag_id
          WHERE tt.todo_id = ?1 ORDER BY g.name",
    )?;
    let rows = stmt.query_map([todo_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ------------------------------------------------------------------- todos

pub fn list_todos(conn: &Connection, q: &TodoQuery) -> Result<Vec<Todo>> {
    let search = q.search.as_ref().map(|s| format!("%{}%", s.trim()));
    let mut stmt = conn.prepare(
        "SELECT t.id, t.project_id, p.name, t.title, t.notes, t.due_date,
                t.position, t.completed_at, t.created_at
           FROM todos t JOIN projects p ON p.id = t.project_id
          WHERE (?1 IS NULL OR t.project_id = ?1)
            AND (?2 IS NULL OR EXISTS (
                  SELECT 1 FROM todo_tags tt JOIN tags g ON g.id = tt.tag_id
                   WHERE tt.todo_id = t.id AND g.name = ?2))
            AND (?3 IS NULL OR t.title LIKE ?3 OR t.notes LIKE ?3)
            AND (?4 = 1 OR t.completed_at IS NULL)
          ORDER BY (t.completed_at IS NOT NULL) ASC,
                   CASE WHEN t.completed_at IS NULL THEN t.position END ASC,
                   t.completed_at DESC",
    )?;
    let rows = stmt.query_map(
        params![
            q.project_id,
            q.tag.as_ref().map(|t| normalize_tag(t)),
            search,
            q.include_completed as i64
        ],
        |r| {
            Ok(Todo {
                id: r.get(0)?,
                project_id: r.get(1)?,
                project_name: r.get(2)?,
                title: r.get(3)?,
                notes: r.get(4)?,
                due_date: r.get(5)?,
                position: r.get(6)?,
                completed_at: r.get(7)?,
                created_at: r.get(8)?,
                tags: Vec::new(),
            })
        },
    )?;
    let mut todos = rows.collect::<rusqlite::Result<Vec<_>>>()?;

    // One extra query for every tag link, then attach in memory.
    let mut by_todo: HashMap<i64, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT tt.todo_id, g.name FROM todo_tags tt
           JOIN tags g ON g.id = tt.tag_id ORDER BY g.name",
    )?;
    let links = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for link in links {
        let (todo_id, name) = link?;
        by_todo.entry(todo_id).or_default().push(name);
    }
    for todo in &mut todos {
        if let Some(tags) = by_todo.remove(&todo.id) {
            todo.tags = tags;
        }
    }
    Ok(todos)
}

pub fn get_todo(conn: &Connection, id: i64) -> Result<Todo> {
    let mut todo = conn
        .query_row(
            "SELECT t.id, t.project_id, p.name, t.title, t.notes, t.due_date,
                    t.position, t.completed_at, t.created_at
               FROM todos t JOIN projects p ON p.id = t.project_id
              WHERE t.id = ?1",
            [id],
            |r| {
                Ok(Todo {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    project_name: r.get(2)?,
                    title: r.get(3)?,
                    notes: r.get(4)?,
                    due_date: r.get(5)?,
                    position: r.get(6)?,
                    completed_at: r.get(7)?,
                    created_at: r.get(8)?,
                    tags: Vec::new(),
                })
            },
        )
        .optional()?
        .ok_or(AppError::NotFound("todo"))?;
    todo.tags = tags_of(conn, id)?;
    Ok(todo)
}

pub fn create_todo(
    conn: &Connection,
    project_id: Option<i64>,
    title: &str,
    due_date: Option<String>,
    tags: &[String],
) -> Result<Todo> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("a todo needs a title".into()));
    }
    let project_id = match project_id {
        Some(id) => id,
        None => default_project_id(conn)?,
    };
    let next: f64 = conn.query_row(
        "SELECT COALESCE(MAX(position), 0.0) + 1.0 FROM todos WHERE project_id = ?1",
        [project_id],
        |r| r.get(0),
    )?;
    let ts = now();
    conn.execute(
        "INSERT INTO todos (project_id, title, notes, due_date, position, created_at, updated_at)
         VALUES (?1, ?2, '', ?3, ?4, ?5, ?5)",
        params![project_id, title, due_date, next, ts],
    )?;
    let id = conn.last_insert_rowid();
    set_tags(conn, id, tags)?;
    get_todo(conn, id)
}

pub fn update_todo(conn: &Connection, id: i64, patch: &TodoPatch) -> Result<Todo> {
    let exists: bool = conn
        .query_row("SELECT 1 FROM todos WHERE id = ?1", [id], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !exists {
        return Err(AppError::NotFound("todo"));
    }

    if let Some(title) = &patch.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::Invalid("a todo needs a title".into()));
        }
        conn.execute(
            "UPDATE todos SET title = ?2 WHERE id = ?1",
            params![id, title],
        )?;
    }
    if let Some(notes) = &patch.notes {
        conn.execute(
            "UPDATE todos SET notes = ?2 WHERE id = ?1",
            params![id, notes],
        )?;
    }
    if let Some(due) = &patch.due_date {
        conn.execute(
            "UPDATE todos SET due_date = ?2 WHERE id = ?1",
            params![id, due],
        )?;
    }
    if let Some(project_id) = patch.project_id {
        let next: f64 = conn.query_row(
            "SELECT COALESCE(MAX(position), 0.0) + 1.0 FROM todos WHERE project_id = ?1",
            [project_id],
            |r| r.get(0),
        )?;
        conn.execute(
            "UPDATE todos SET project_id = ?2, position = ?3 WHERE id = ?1",
            params![id, project_id, next],
        )?;
    }
    if let Some(tags) = &patch.tags {
        set_tags(conn, id, tags)?;
    }
    conn.execute(
        "UPDATE todos SET updated_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    get_todo(conn, id)
}

pub fn delete_todo(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute("DELETE FROM todos WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::NotFound("todo"));
    }
    Ok(())
}

/// Toggles completion and records it in the activity log in one transaction,
/// so the heatmap can never drift from the list.
pub fn set_completed(
    conn: &mut Connection,
    id: i64,
    done: bool,
    tz_offset_minutes: i32,
) -> Result<Todo> {
    let todo = get_todo(conn, id)?;
    if todo.completed_at.is_some() == done {
        return Ok(todo);
    }
    let at = now();
    let date = local_date(at, tz_offset_minutes);
    let kind = if done { "complete" } else { "uncomplete" };

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE todos SET completed_at = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, if done { Some(at) } else { None }, at],
    )?;
    tx.execute(
        "INSERT INTO activity (todo_id, title, project_name, tags, kind, at, local_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            todo.title,
            todo.project_name,
            todo.tags.join(","),
            kind,
            at,
            date
        ],
    )?;
    tx.commit()?;
    get_todo(conn, id)
}

/// Moves `id` so it sits between `before_id` (above) and `after_id` (below).
/// Either may be `None` at the ends of the list. Returns the new position.
pub fn move_todo(
    conn: &mut Connection,
    id: i64,
    project_id: Option<i64>,
    before_id: Option<i64>,
    after_id: Option<i64>,
) -> Result<f64> {
    let todo = get_todo(conn, id)?;
    let target_project = project_id.unwrap_or(todo.project_id);

    let pos_of = |conn: &Connection, other: Option<i64>| -> Result<Option<f64>> {
        match other {
            None => Ok(None),
            Some(other_id) => {
                let row: Option<(i64, f64)> = conn
                    .query_row(
                        "SELECT project_id, position FROM todos WHERE id = ?1",
                        [other_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;
                match row {
                    Some((pid, pos)) if pid == target_project => Ok(Some(pos)),
                    Some(_) => Err(AppError::Invalid(
                        "neighbour todo is in a different list".into(),
                    )),
                    None => Err(AppError::NotFound("todo")),
                }
            }
        }
    };

    let mut before = pos_of(conn, before_id)?;
    let mut after = pos_of(conn, after_id)?;

    // If the gap has been divided into nothing, spread the list back out and
    // re-read the neighbours before computing the midpoint.
    if let (Some(b), Some(a)) = (before, after) {
        if (a - b).abs() < MIN_GAP {
            renormalize(conn, target_project)?;
            before = pos_of(conn, before_id)?;
            after = pos_of(conn, after_id)?;
        }
    }

    let position = match (before, after) {
        (Some(b), Some(a)) => (b + a) / 2.0,
        (Some(b), None) => b + 1.0,
        (None, Some(a)) => a - 1.0,
        (None, None) => conn.query_row(
            "SELECT COALESCE(MAX(position), 0.0) + 1.0 FROM todos WHERE project_id = ?1",
            [target_project],
            |r| r.get(0),
        )?,
    };

    conn.execute(
        "UPDATE todos SET project_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, target_project, position, now()],
    )?;
    Ok(position)
}

/// Rewrites a list's positions as 1.0, 2.0, 3.0 ... keeping the current order.
fn renormalize(conn: &mut Connection, project_id: i64) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE todos SET position = (
             SELECT rn FROM (
                 SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rn
                   FROM todos WHERE project_id = ?1
             ) ranked WHERE ranked.id = todos.id)
         WHERE project_id = ?1",
        [project_id],
    )?;
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------- activity

/// Completions per day between two `YYYY-MM-DD` dates, inclusive.
/// Un-completing subtracts, so a day never counts work that was undone.
pub fn activity_heatmap(conn: &Connection, from: &str, to: &str) -> Result<Vec<DayCount>> {
    let mut stmt = conn.prepare(
        "SELECT local_date,
                SUM(CASE kind WHEN 'complete' THEN 1 ELSE -1 END) AS count
           FROM activity
          WHERE local_date BETWEEN ?1 AND ?2
          GROUP BY local_date
         HAVING count > 0
          ORDER BY local_date",
    )?;
    let rows = stmt.query_map(params![from, to], |r| {
        Ok(DayCount {
            date: r.get(0)?,
            count: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// What was actually finished in a date range, grouped by day, newest first.
///
/// A completion is only listed if it was not later undone: for each todo and
/// day, completes and un-completes are paired off and the surplus completes
/// are what remain.
pub fn activity_range(conn: &Connection, from: &str, to: &str) -> Result<Vec<ActivityDay>> {
    let mut stmt = conn.prepare(
        "SELECT id, todo_id, title, project_name, tags, kind, at, local_date
           FROM activity
          WHERE local_date BETWEEN ?1 AND ?2
          ORDER BY local_date DESC, at ASC, id ASC",
    )?;
    struct Row {
        todo_id: Option<i64>,
        title: String,
        project_name: String,
        tags: String,
        kind: String,
        at: i64,
        date: String,
    }
    let rows = stmt.query_map(params![from, to], |r| {
        Ok(Row {
            todo_id: r.get(1)?,
            title: r.get(2)?,
            project_name: r.get(3)?,
            tags: r.get(4)?,
            kind: r.get(5)?,
            at: r.get(6)?,
            date: r.get(7)?,
        })
    })?;

    let mut days: Vec<ActivityDay> = Vec::new();
    // Per day, the completions still standing for each todo, in order.
    let mut open: HashMap<(String, Option<i64>), Vec<ActivityItem>> = HashMap::new();

    for row in rows {
        let row = row?;
        let key = (row.date.clone(), row.todo_id);
        if days.last().map(|d| d.date.as_str()) != Some(row.date.as_str()) {
            days.push(ActivityDay {
                date: row.date.clone(),
                items: Vec::new(),
            });
        }
        let bucket = open.entry(key).or_default();
        if row.kind == "complete" {
            bucket.push(ActivityItem {
                title: row.title,
                project_name: row.project_name,
                tags: row
                    .tags
                    .split(',')
                    .filter(|t| !t.is_empty())
                    .map(str::to_string)
                    .collect(),
                at: row.at,
                date: row.date,
            });
        } else {
            bucket.pop();
        }
    }

    for day in &mut days {
        let mut items: Vec<ActivityItem> = open
            .iter()
            .filter(|((date, _), _)| date == &day.date)
            .flat_map(|(_, items)| items.iter().cloned())
            .collect();
        items.sort_by_key(|i| std::cmp::Reverse(i.at));
        day.items = items;
    }
    days.retain(|d| !d.items.is_empty());
    Ok(days)
}

// ---------------------------------------------------------------- settings

pub fn get_settings(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<HashMap<String, String>>>()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
