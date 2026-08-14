use super::*;
use crate::db::open_memory;

fn titles(conn: &Connection, project_id: i64) -> Vec<String> {
    list_todos(
        conn,
        &TodoQuery {
            project_id: Some(project_id),
            ..Default::default()
        },
    )
    .unwrap()
    .into_iter()
    .map(|t| t.title)
    .collect()
}

fn seed(conn: &Connection, names: &[&str]) -> (i64, Vec<i64>) {
    let project = default_project_id(conn).unwrap();
    let ids = names
        .iter()
        .map(|n| create_todo(conn, Some(project), n, None, &[]).unwrap().id)
        .collect();
    (project, ids)
}

#[test]
fn default_inbox_exists() {
    let conn = open_memory();
    let projects = list_projects(&conn).unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "Inbox");
    assert!(projects[0].is_default);
}

#[test]
fn local_date_respects_timezone_offset() {
    // 2026-03-04T23:30:00Z
    let at = 1_772_667_000;
    assert_eq!(local_date(at, 0), "2026-03-04");
    // UTC+2 (offset -120) has already rolled over to the 5th.
    assert_eq!(local_date(at, -120), "2026-03-05");
    // UTC-5 is still on the 4th.
    assert_eq!(local_date(at, 300), "2026-03-04");
    // Epoch and a leap day, as sanity checks on the civil-date maths.
    assert_eq!(local_date(0, 0), "1970-01-01");
    assert_eq!(local_date(1_709_164_800, 0), "2024-02-29");
}

#[test]
fn new_todos_land_at_the_bottom() {
    let conn = open_memory();
    let (project, _) = seed(&conn, &["a", "b", "c"]);
    assert_eq!(titles(&conn, project), ["a", "b", "c"]);
}

#[test]
fn move_between_neighbours_writes_one_row() {
    let mut conn = open_memory();
    let (project, ids) = seed(&conn, &["a", "b", "c"]);
    // Drag "c" between "a" and "b".
    move_todo(&mut conn, ids[2], None, Some(ids[0]), Some(ids[1])).unwrap();
    assert_eq!(titles(&conn, project), ["a", "c", "b"]);
}

#[test]
fn move_to_either_end() {
    let mut conn = open_memory();
    let (project, ids) = seed(&conn, &["a", "b", "c"]);
    move_todo(&mut conn, ids[2], None, None, Some(ids[0])).unwrap();
    assert_eq!(titles(&conn, project), ["c", "a", "b"]);
    move_todo(&mut conn, ids[2], None, Some(ids[1]), None).unwrap();
    assert_eq!(titles(&conn, project), ["a", "b", "c"]);
}

#[test]
fn a_collapsed_gap_renormalizes_instead_of_colliding() {
    let mut conn = open_memory();
    let (project, ids) = seed(&conn, &["a", "b", "c"]);
    // Simulate a list that has been subdivided until no float fits between
    // "a" and "b" any more.
    conn.execute(
        "UPDATE todos SET position = 1.0 + 1e-12 WHERE id = ?1",
        [ids[1]],
    )
    .unwrap();

    move_todo(&mut conn, ids[2], None, Some(ids[0]), Some(ids[1])).unwrap();
    assert_eq!(titles(&conn, project), ["a", "c", "b"]);
    let positions: Vec<f64> = list_todos(
        &conn,
        &TodoQuery {
            project_id: Some(project),
            ..Default::default()
        },
    )
    .unwrap()
    .iter()
    .map(|t| t.position)
    .collect();
    for pair in positions.windows(2) {
        assert!(
            (pair[1] - pair[0]).abs() >= MIN_GAP,
            "positions collapsed: {positions:?}"
        );
    }
}

#[test]
fn moving_to_another_project_keeps_it_last_there() {
    let mut conn = open_memory();
    let (inbox, ids) = seed(&conn, &["a", "b"]);
    let work = create_project(&conn, "Work").unwrap();
    let other = create_todo(&conn, Some(work), "w1", None, &[]).unwrap().id;
    move_todo(&mut conn, ids[0], Some(work), Some(other), None).unwrap();
    assert_eq!(titles(&conn, work), ["w1", "a"]);
    assert_eq!(titles(&conn, inbox), ["b"]);
}

#[test]
fn completing_records_activity_and_uncompleting_reverses_it() {
    let mut conn = open_memory();
    let (_, ids) = seed(&conn, &["write tests"]);
    let today = local_date(now(), 0);

    let todo = set_completed(&mut conn, ids[0], true, 0).unwrap();
    assert!(todo.completed_at.is_some());
    assert_eq!(activity_heatmap(&conn, &today, &today).unwrap()[0].count, 1);

    set_completed(&mut conn, ids[0], false, 0).unwrap();
    assert!(activity_heatmap(&conn, &today, &today).unwrap().is_empty());

    // Redoing it counts once, not twice.
    set_completed(&mut conn, ids[0], true, 0).unwrap();
    assert_eq!(activity_heatmap(&conn, &today, &today).unwrap()[0].count, 1);
    let days = activity_range(&conn, &today, &today).unwrap();
    assert_eq!(days.len(), 1);
    assert_eq!(days[0].items.len(), 1);
    assert_eq!(days[0].items[0].title, "write tests");
}

#[test]
fn toggling_twice_is_a_no_op_for_the_log() {
    let mut conn = open_memory();
    let (_, ids) = seed(&conn, &["a"]);
    set_completed(&mut conn, ids[0], true, 0).unwrap();
    set_completed(&mut conn, ids[0], true, 0).unwrap();
    let today = local_date(now(), 0);
    assert_eq!(activity_heatmap(&conn, &today, &today).unwrap()[0].count, 1);
}

#[test]
fn history_survives_deleting_the_todo_and_renaming_the_project() {
    let mut conn = open_memory();
    let (project, ids) = seed(&conn, &["ship it"]);
    set_completed(&mut conn, ids[0], true, 0).unwrap();
    delete_todo(&conn, ids[0]).unwrap();
    rename_project(&conn, project, "Renamed").unwrap();

    let today = local_date(now(), 0);
    let days = activity_range(&conn, &today, &today).unwrap();
    assert_eq!(days[0].items[0].title, "ship it");
    assert_eq!(days[0].items[0].project_name, "Inbox");
}

#[test]
fn activity_range_groups_by_day_within_the_window() {
    let conn = open_memory();
    let insert = |title: &str, date: &str, at: i64, kind: &str| {
        conn.execute(
            "INSERT INTO activity (todo_id, title, project_name, tags, kind, at, local_date)
             VALUES (NULL, ?1, 'Inbox', '', ?2, ?3, ?4)",
            params![title, kind, at, date],
        )
        .unwrap();
    };
    insert("older", "2026-03-01", 100, "complete");
    insert("first", "2026-03-04", 200, "complete");
    insert("second", "2026-03-04", 300, "complete");
    insert("newer", "2026-03-09", 400, "complete");

    let days = activity_range(&conn, "2026-03-02", "2026-03-08").unwrap();
    assert_eq!(days.len(), 1);
    assert_eq!(days[0].date, "2026-03-04");
    // Newest completion of the day first.
    assert_eq!(
        days[0].items.iter().map(|i| &i.title).collect::<Vec<_>>(),
        ["second", "first"]
    );

    let counts = activity_heatmap(&conn, "2026-03-01", "2026-03-31").unwrap();
    assert_eq!(counts.len(), 3);
    assert_eq!(counts[1].date, "2026-03-04");
    assert_eq!(counts[1].count, 2);
}

#[test]
fn tag_filter_spans_projects() {
    let conn = open_memory();
    let inbox = default_project_id(&conn).unwrap();
    let work = create_project(&conn, "Work").unwrap();
    create_todo(&conn, Some(inbox), "buy milk", None, &["Home".into()]).unwrap();
    create_todo(&conn, Some(work), "file taxes", None, &["#home".into()]).unwrap();
    create_todo(&conn, Some(work), "deploy", None, &[]).unwrap();

    let tagged = list_todos(
        &conn,
        &TodoQuery {
            tag: Some("home".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(tagged.len(), 2);
    let tags = list_tags(&conn).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "home");
    assert_eq!(tags[0].open_count, 2);
}

#[test]
fn search_matches_title_and_notes() {
    let conn = open_memory();
    let (_, ids) = seed(&conn, &["alpha", "beta"]);
    update_todo(
        &conn,
        ids[1],
        &TodoPatch {
            notes: Some("mentions alpha in the body".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let hits = list_todos(
        &conn,
        &TodoQuery {
            search: Some("alpha".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(hits.len(), 2);
}

#[test]
fn patch_can_set_and_clear_a_due_date() {
    let conn = open_memory();
    let (_, ids) = seed(&conn, &["a"]);
    let todo = update_todo(
        &conn,
        ids[0],
        &TodoPatch {
            due_date: Some(Some("2026-08-20".into())),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(todo.due_date.as_deref(), Some("2026-08-20"));

    let todo = update_todo(
        &conn,
        ids[0],
        &TodoPatch {
            title: Some("renamed".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(todo.due_date.as_deref(), Some("2026-08-20"));

    let todo = update_todo(
        &conn,
        ids[0],
        &TodoPatch {
            due_date: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(todo.due_date, None);
}

#[test]
fn completed_todos_are_hidden_unless_asked_for() {
    let mut conn = open_memory();
    let (project, ids) = seed(&conn, &["a", "b"]);
    set_completed(&mut conn, ids[0], true, 0).unwrap();
    assert_eq!(titles(&conn, project), ["b"]);

    let all = list_todos(
        &conn,
        &TodoQuery {
            project_id: Some(project),
            include_completed: true,
            ..Default::default()
        },
    )
    .unwrap();
    // Active first, completed after.
    assert_eq!(all.iter().map(|t| &t.title).collect::<Vec<_>>(), ["b", "a"]);
}

#[test]
fn deleting_a_project_rehomes_its_todos() {
    let mut conn = open_memory();
    let (inbox, _) = seed(&conn, &["keep"]);
    let work = create_project(&conn, "Work").unwrap();
    create_todo(&conn, Some(work), "w1", None, &[]).unwrap();
    create_todo(&conn, Some(work), "w2", None, &[]).unwrap();

    delete_project(&mut conn, work).unwrap();
    assert_eq!(titles(&conn, inbox), ["keep", "w1", "w2"]);
    assert!(delete_project(&mut conn, inbox).is_err());
}

#[test]
fn settings_round_trip() {
    let conn = open_memory();
    set_setting(&conn, "theme", "dark").unwrap();
    set_setting(&conn, "theme", "light").unwrap();
    assert_eq!(get_settings(&conn).unwrap().get("theme").unwrap(), "light");
}
