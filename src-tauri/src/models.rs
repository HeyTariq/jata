use serde::{Deserialize, Deserializer, Serialize};

/// Distinguishes "field absent" (`None`) from "field explicitly null"
/// (`Some(None)`) so a patch can clear a nullable column.
fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub position: f64,
    pub is_default: bool,
    pub open_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: i64,
    pub project_id: i64,
    pub project_name: String,
    pub title: String,
    pub notes: String,
    pub due_date: Option<String>,
    pub position: f64,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub open_count: i64,
}

/// Filter for `list_todos`. All fields are optional and combine with AND.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoQuery {
    pub project_id: Option<i64>,
    pub tag: Option<String>,
    pub search: Option<String>,
    #[serde(default)]
    pub include_completed: bool,
}

/// Partial update for `update_todo`. `None` means "leave alone"; the nested
/// `Option` on `due_date` lets the caller clear the date explicitly.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<String>>,
    pub project_id: Option<i64>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCount {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub title: String,
    pub project_name: String,
    pub tags: Vec<String>,
    pub at: i64,
    pub date: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDay {
    pub date: String,
    pub items: Vec<ActivityItem>,
}
