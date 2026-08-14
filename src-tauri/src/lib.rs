mod commands;
mod db;
mod error;
mod models;
mod store;

use std::sync::Mutex;

use tauri::Manager;

use commands::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("jata.db");
            let conn = db::open(&path)?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::create_project,
            commands::rename_project,
            commands::delete_project,
            commands::list_tags,
            commands::list_todos,
            commands::create_todo,
            commands::update_todo,
            commands::delete_todo,
            commands::set_completed,
            commands::move_todo,
            commands::activity_heatmap,
            commands::activity_range,
            commands::get_settings,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running jata");
}
