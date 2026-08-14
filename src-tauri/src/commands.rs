use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::State;

use crate::error::Result;
use crate::models::*;
use crate::store;

pub struct Db(pub Mutex<Connection>);

impl Db {
    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A poisoned lock means an earlier command panicked mid-query. The
        // connection itself is still usable, so carry on with it.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[tauri::command]
pub fn list_projects(db: State<'_, Db>) -> Result<Vec<Project>> {
    store::list_projects(&db.lock())
}

#[tauri::command]
pub fn create_project(db: State<'_, Db>, name: String) -> Result<Vec<Project>> {
    let conn = db.lock();
    store::create_project(&conn, &name)?;
    store::list_projects(&conn)
}

#[tauri::command]
pub fn rename_project(db: State<'_, Db>, id: i64, name: String) -> Result<Vec<Project>> {
    let conn = db.lock();
    store::rename_project(&conn, id, &name)?;
    store::list_projects(&conn)
}

#[tauri::command]
pub fn delete_project(db: State<'_, Db>, id: i64) -> Result<Vec<Project>> {
    let mut conn = db.lock();
    store::delete_project(&mut conn, id)?;
    store::list_projects(&conn)
}

#[tauri::command]
pub fn list_tags(db: State<'_, Db>) -> Result<Vec<Tag>> {
    store::list_tags(&db.lock())
}

#[tauri::command]
pub fn list_todos(db: State<'_, Db>, query: TodoQuery) -> Result<Vec<Todo>> {
    store::list_todos(&db.lock(), &query)
}

#[tauri::command]
pub fn create_todo(
    db: State<'_, Db>,
    project_id: Option<i64>,
    title: String,
    due_date: Option<String>,
    tags: Vec<String>,
) -> Result<Todo> {
    store::create_todo(&db.lock(), project_id, &title, due_date, &tags)
}

#[tauri::command]
pub fn update_todo(db: State<'_, Db>, id: i64, patch: TodoPatch) -> Result<Todo> {
    store::update_todo(&db.lock(), id, &patch)
}

#[tauri::command]
pub fn delete_todo(db: State<'_, Db>, id: i64) -> Result<()> {
    store::delete_todo(&db.lock(), id)
}

#[tauri::command]
pub fn set_completed(
    db: State<'_, Db>,
    id: i64,
    done: bool,
    tz_offset_minutes: i32,
) -> Result<Todo> {
    store::set_completed(&mut db.lock(), id, done, tz_offset_minutes)
}

#[tauri::command]
pub fn move_todo(
    db: State<'_, Db>,
    id: i64,
    project_id: Option<i64>,
    before_id: Option<i64>,
    after_id: Option<i64>,
) -> Result<f64> {
    store::move_todo(&mut db.lock(), id, project_id, before_id, after_id)
}

#[tauri::command]
pub fn activity_heatmap(db: State<'_, Db>, from: String, to: String) -> Result<Vec<DayCount>> {
    store::activity_heatmap(&db.lock(), &from, &to)
}

#[tauri::command]
pub fn activity_range(db: State<'_, Db>, from: String, to: String) -> Result<Vec<ActivityDay>> {
    store::activity_range(&db.lock(), &from, &to)
}

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> Result<HashMap<String, String>> {
    store::get_settings(&db.lock())
}

#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<()> {
    store::set_setting(&db.lock(), &key, &value)
}
