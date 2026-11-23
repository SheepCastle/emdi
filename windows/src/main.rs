#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod file_resolver;

use base64::Engine;
use file_resolver::{
    can_open_in_tab, classify_file_kind, ext_lower, find_vault_root, list_tree_children,
    mime_for_path, norm_path, resolve_local_target, resolve_periodic_note_path, search_tree_files,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    theme_id: String,
    accent_id: String,
    font_size: f64,
    narrow_width: bool,
    auto_save: bool,
    default_vault_path: String,
    #[serde(default)]
    last_session_tabs: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme_id: "catppuccin-mocha".to_string(),
            accent_id: "auto".to_string(),
            font_size: 15.5,
            narrow_width: false,
            auto_save: false,
            default_vault_path: String::new(),
            last_session_tabs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct TabRecord {
    id: String,
    file_path: Option<PathBuf>,
    is_dirty: bool,
}

struct AppState {
    settings: AppSettings,
    tabs: Vec<TabRecord>,
    active_tab_id: Option<String>,
    closed_history: Vec<PathBuf>,
    tab_seq: u64,
    initial_args: Vec<PathBuf>,
    latest_release_url: Option<String>,
}

impl AppState {
    fn config_path() -> PathBuf {
        let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        base.join("emdi").join("settings.json")
    }

    fn load_settings() -> AppSettings {
        let path = Self::config_path();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<AppSettings>(&raw) {
                return parsed;
            }
        }
        AppSettings::default()
    }

    fn save_settings(&self) {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json_str) = serde_json::to_string_pretty(&self.settings) {
            let _ = fs::write(path, json_str);
        }
    }

    fn next_tab_id(&mut self) -> String {
        self.tab_seq += 1;
        format!("tab-{}", self.tab_seq)
    }

    fn persist_session(&mut self) {
        self.settings.last_session_tabs = self
            .tabs
            .iter()
            .filter_map(|t| t.file_path.as_ref().map(|p| norm_path(p)))
            .collect();
        self.save_settings();
    }
}

fn call_web_js(app: &AppHandle, method: &str, payload: &Value) {
    if let Some(win) = app.get_webview_window("main") {
        let json_str = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
        let js = format!(
            "window.__emdi && window.__emdi.{} && window.__emdi.{}({});",
            method, method, json_str
        );
        let _ = win.eval(&js);
    }
}

fn preview_url_for(path: &Path, tab_id: &str) -> String {
    let encoded_path = urlencoding::encode(&norm_path(path));
    format!(
        "http://emdi-local.localhost/file?path={}&tabId={}",
        encoded_path,
        urlencoding::encode(tab_id)
    )
}

fn open_file_in_tab(
    app: &AppHandle,
    state_arc: &Arc<Mutex<AppState>>,
    path: PathBuf,
    anchor: Option<String>,
) {
    if !can_open_in_tab(&path) {
        let _ = open::that(&path);
        return;
    }

    let mut st = state_arc.lock().unwrap();
    let norm = norm_path(&path);

    if let Some(existing) = st
        .tabs
        .iter()
        .find(|t| t.file_path.as_ref().map(|p| norm_path(p)) == Some(norm.clone()))
        .cloned()
    {
        st.active_tab_id = Some(existing.id.clone());
        drop(st);
        call_web_js(
            app,
            "activateTab",
            &json!({ "tabId": existing.id, "anchor": anchor }),
        );
        return;
    }

    let kind = classify_file_kind(&path, false);
    let ext = ext_lower(&path);
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("제목 없음.md")
        .to_string();
    let file_size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let content = if kind == "pdf" || kind == "image" {
        String::new()
    } else {
        fs::read_to_string(&path).unwrap_or_default()
    };

    // Replace single untouched empty tab if present
    let tab_id = if st.tabs.len() == 1 && st.tabs[0].file_path.is_none() && !st.tabs[0].is_dirty {
        let id = st.tabs[0].id.clone();
        st.tabs[0].file_path = Some(path.clone());
        id
    } else {
        let id = st.next_tab_id();
        st.tabs.push(TabRecord {
            id: id.clone(),
            file_path: Some(path.clone()),
            is_dirty: false,
        });
        id
    };

    st.active_tab_id = Some(tab_id.clone());
    st.persist_session();
    let p_url = preview_url_for(&path, &tab_id);
    drop(st);

    call_web_js(
        app,
        "openTab",
        &json!({
            "tabId": tab_id,
            "fileName": file_name,
            "filePath": norm,
            "fileKind": kind,
            "ext": ext,
            "previewURL": p_url,
            "fileSize": file_size,
            "content": content,
            "activate": true,
            "anchor": anchor,
        }),
    );
}

fn open_empty_tab(app: &AppHandle, state_arc: &Arc<Mutex<AppState>>) {
    let mut st = state_arc.lock().unwrap();
    let tab_id = st.next_tab_id();
    st.tabs.push(TabRecord {
        id: tab_id.clone(),
        file_path: None,
        is_dirty: false,
    });
    st.active_tab_id = Some(tab_id.clone());
    drop(st);

    call_web_js(
        app,
        "openTab",
        &json!({
            "tabId": tab_id,
            "fileName": "제목 없음.md",
            "filePath": "",
            "fileKind": "markdown",
            "ext": "md",
            "previewURL": "",
            "fileSize": 0,
            "content": "",
            "activate": true,
        }),
    );
}

fn check_updates_async(app: AppHandle, state_arc: Arc<Mutex<AppState>>, interactive: bool) {
    std::thread::spawn(move || {
        if interactive {
            call_web_js(
                &app,
                "onUpdateState",
                &json!({
                    "status": "checking",
                    "currentVersion": APP_VERSION,
                    "hasUpdate": false,
                }),
            );
        }
        let resp = ureq::get("https://api.github.com/repos/SheepCastle/emdi/releases/latest")
            .set("User-Agent", "emdi-windows")
            .call();

        match resp {
            Ok(r) => {
                if let Ok(json_val) = r.into_json::<Value>() {
                    let tag = json_val
                        .get("tag_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim_start_matches('v')
                        .to_string();
                    let html_url = json_val
                        .get("html_url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("https://github.com/SheepCastle/emdi/releases/latest")
                        .to_string();
                    let has_update = !tag.is_empty() && tag != APP_VERSION;
                    {
                        let mut st = state_arc.lock().unwrap();
                        st.latest_release_url = Some(html_url.clone());
                    }
                    call_web_js(
                        &app,
                        "onUpdateState",
                        &json!({
                            "status": if has_update { "available" } else { "upToDate" },
                            "currentVersion": APP_VERSION,
                            "latestVersion": tag,
                            "releaseURL": html_url,
                            "hasUpdate": has_update,
                            "toast": if interactive && !has_update { Some("최신 버전을 사용 중입니다") } else { None },
                        }),
                    );
                }
            }
            Err(_) => {
                if interactive {
                    call_web_js(
                        &app,
                        "onUpdateState",
                        &json!({
                            "status": "error",
                            "currentVersion": APP_VERSION,
                            "hasUpdate": false,
                            "toast": "업데이트 정보를 확인하지 못했습니다",
                        }),
                    );
                }
            }
        }
    });
}

fn load_bundled_changelog() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("CHANGELOG.md");
            if let Ok(text) = fs::read_to_string(p) {
                return text;
            }
        }
    }
    String::new()
}

#[tauri::command]
fn emdi_message(
    app: AppHandle,
    state: State<'_, Arc<Mutex<AppState>>>,
    payload: Value,
) {
    let msg_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let state_arc = state.inner().clone();

    match msg_type {
        "ready" => {
            let (settings, args) = {
                let mut st = state_arc.lock().unwrap();
                let s = st.settings.clone();
                let a = std::mem::take(&mut st.initial_args);
                (s, a)
            };

            call_web_js(
                &app,
                "applySettings",
                &json!({
                    "themeId": settings.theme_id,
                    "accentId": settings.accent_id,
                    "fontSize": settings.font_size,
                    "narrowWidth": settings.narrow_width,
                    "autoSave": settings.auto_save,
                    "defaultVaultPath": settings.default_vault_path,
                }),
            );
            call_web_js(&app, "setAutoSave", &json!({ "enabled": settings.auto_save }));
            call_web_js(
                &app,
                "setChangelog",
                &json!({ "markdown": load_bundled_changelog() }),
            );
            call_web_js(
                &app,
                "onUpdateState",
                &json!({
                    "status": "idle",
                    "currentVersion": APP_VERSION,
                    "hasUpdate": false,
                }),
            );

            let mut opened_any = false;
            for arg in args {
                if arg.is_dir() {
                    call_web_js(&app, "openFolder", &json!({ "path": norm_path(&arg) }));
                } else if arg.is_file() {
                    open_file_in_tab(&app, &state_arc, arg, None);
                    opened_any = true;
                }
            }

            if !opened_any {
                let saved_paths: Vec<PathBuf> = settings
                    .last_session_tabs
                    .iter()
                    .map(PathBuf::from)
                    .filter(|p| p.is_file())
                    .collect();
                if !saved_paths.is_empty() {
                    for p in saved_paths {
                        open_file_in_tab(&app, &state_arc, p, None);
                    }
                } else {
                    open_empty_tab(&app, &state_arc);
                }
            }

            check_updates_async(app.clone(), state_arc, false);
        }

        "newTab" => {
            open_empty_tab(&app, &state_arc);
        }

        "switchTab" => {
            if let Some(id) = payload.get("tabId").and_then(|v| v.as_str()) {
                let mut st = state_arc.lock().unwrap();
                st.active_tab_id = Some(id.to_string());
            }
        }

        "dirtyChanged" => {
            if let (Some(id), Some(dirty)) = (
                payload.get("tabId").and_then(|v| v.as_str()),
                payload.get("dirty").and_then(|v| v.as_bool()),
            ) {
                let mut st = state_arc.lock().unwrap();
                if let Some(tab) = st.tabs.iter_mut().find(|t| t.id == id) {
                    tab.is_dirty = dirty;
                }
            }
        }

        "closeTab" => {
            let tab_id = payload
                .get("tabId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut st = state_arc.lock().unwrap();
            if let Some(idx) = st.tabs.iter().position(|t| t.id == tab_id) {
                let removed = st.tabs.remove(idx);
                if let Some(p) = removed.file_path {
                    st.closed_history.push(p);
                }
                let next_id = st
                    .tabs
                    .get(idx.saturating_sub(1))
                    .or_else(|| st.tabs.first())
                    .map(|t| t.id.clone());
                st.active_tab_id = next_id.clone();
                let is_empty = st.tabs.is_empty();
                st.persist_session();
                drop(st);
                call_web_js(
                    &app,
                    "closeTab",
                    &json!({ "tabId": tab_id, "nextActiveTabId": next_id }),
                );
                if is_empty {
                    open_empty_tab(&app, &state_arc);
                }
            }
        }

        "reopenClosedTab" => {
            let path_opt = {
                let mut st = state_arc.lock().unwrap();
                st.closed_history.pop()
            };
            if let Some(p) = path_opt {
                if p.is_file() {
                    open_file_in_tab(&app, &state_arc, p, None);
                }
            }
        }

        "openFile" => {
            let app_clone = app.clone();
            let state_clone = state_arc.clone();
            std::thread::spawn(move || {
                if let Some(files) = rfd::FileDialog::new().pick_files() {
                    for f in files {
                        open_file_in_tab(&app_clone, &state_clone, f, None);
                    }
                }
            });
        }

        "openFolder" => {
            let app_clone = app.clone();
            std::thread::spawn(move || {
                if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                    call_web_js(&app_clone, "openFolder", &json!({ "path": norm_path(&dir) }));
                }
            });
        }

        "openFilePath" => {
            if let Some(path_str) = payload.get("path").and_then(|v| v.as_str()) {
                let p = PathBuf::from(path_str);
                if p.is_dir() {
                    call_web_js(&app, "openFolder", &json!({ "path": norm_path(&p) }));
                } else if p.is_file() {
                    open_file_in_tab(&app, &state_arc, p, None);
                }
            }
        }

        "openLink" => {
            let target = payload
                .get("target")
                .or_else(|| payload.get("href"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let is_wiki = payload
                .get("isWiki")
                .or_else(|| payload.get("isWikiLink"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("mailto:") {
                let _ = open::that(target);
                return;
            }
            let (base_file, default_vault) = {
                let st = state_arc.lock().unwrap();
                let tab_id = payload
                    .get("tabId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| st.active_tab_id.clone());
                let base = tab_id
                    .and_then(|id| st.tabs.iter().find(|t| t.id == id))
                    .and_then(|t| t.file_path.clone());
                let vault = if st.settings.default_vault_path.is_empty() {
                    None
                } else {
                    Some(PathBuf::from(&st.settings.default_vault_path))
                };
                (base, vault)
            };
            if let Some((resolved, anchor)) =
                resolve_local_target(target, base_file.as_deref(), default_vault.as_deref(), is_wiki)
            {
                open_file_in_tab(&app, &state_arc, resolved, anchor);
            } else {
                call_web_js(&app, "showToast", &json!({ "message": format!("파일을 찾을 수 없습니다: {}", target) }));
            }
        }

        "save" | "saveAs" => {
            let force_dialog = msg_type == "saveAs";
            let tab_id = payload
                .get("tabId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let content = payload
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let silent = payload
                .get("silent")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let existing_path = {
                let st = state_arc.lock().unwrap();
                st.tabs
                    .iter()
                    .find(|t| t.id == tab_id)
                    .and_then(|t| t.file_path.clone())
            };

            let target_path = if !force_dialog && existing_path.is_some() {
                existing_path
            } else {
                rfd::FileDialog::new()
                    .set_file_name("제목 없음.md")
                    .add_filter("Markdown", &["md", "markdown"])
                    .add_filter("All Files", &["*"])
                    .save_file()
            };

            if let Some(path) = target_path {
                if fs::write(&path, &content).is_ok() {
                    let norm = norm_path(&path);
                    let file_name = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("제목 없음.md")
                        .to_string();
                    let p_url = preview_url_for(&path, &tab_id);
                    {
                        let mut st = state_arc.lock().unwrap();
                        if let Some(tab) = st.tabs.iter_mut().find(|t| t.id == tab_id) {
                            tab.file_path = Some(path);
                            tab.is_dirty = false;
                        }
                        st.persist_session();
                    }
                    call_web_js(
                        &app,
                        "markSaved",
                        &json!({
                            "tabId": tab_id,
                            "fileName": file_name,
                            "filePath": norm,
                            "previewURL": p_url,
                            "silent": silent,
                        }),
                    );
                }
            }
        }

        "listTreeChildren" => {
            let dir_str = payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let only_md = payload
                .get("onlyMarkdown")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let req_id = payload
                .get("requestId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let res = list_tree_children(Path::new(dir_str), only_md, req_id);
            if let Ok(val) = serde_json::to_value(res) {
                call_web_js(&app, "onTreeChildrenLoaded", &val);
            }
        }

        "searchTreeFiles" => {
            let root_str = payload.get("rootPath").and_then(|v| v.as_str()).unwrap_or("");
            let query = payload.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let only_md = payload
                .get("onlyMarkdown")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let target = payload
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or("tree")
                .to_string();
            let req_id = payload
                .get("requestId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let res = search_tree_files(Path::new(root_str), query, only_md, target, req_id);
            if let Ok(val) = serde_json::to_value(res) {
                call_web_js(&app, "onTreeSearchResults", &val);
            }
        }

        "saveImage" => {
            let req_id = payload
                .get("requestId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let base64_data = payload.get("base64").and_then(|v| v.as_str()).unwrap_or("");
            let ext = payload.get("ext").and_then(|v| v.as_str()).unwrap_or("png");
            let alt = payload.get("alt").and_then(|v| v.as_str()).unwrap_or("");
            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");

            let doc_path = {
                let st = state_arc.lock().unwrap();
                st.tabs
                    .iter()
                    .find(|t| t.id == tab_id)
                    .and_then(|t| t.file_path.clone())
            };

            let Some(doc_dir) = doc_path.as_deref().and_then(|p| p.parent()) else {
                call_web_js(
                    &app,
                    "onImageSaveError",
                    &json!({ "requestId": req_id, "message": "먼저 문서를 저장한 뒤 이미지를 붙여넣으세요" }),
                );
                return;
            };

            let assets_dir = doc_dir.join("assets");
            let _ = fs::create_dir_all(&assets_dir);
            let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let file_name = format!("pasted-{}.{}", ts, ext);
            let dest = assets_dir.join(&file_name);

            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(base64_data) {
                if fs::write(&dest, bytes).is_ok() {
                    call_web_js(
                        &app,
                        "onImageSaved",
                        &json!({
                            "requestId": req_id,
                            "relativePath": format!("assets/{}", file_name),
                            "alt": alt,
                        }),
                    );
                    return;
                }
            }
            call_web_js(
                &app,
                "onImageSaveError",
                &json!({ "requestId": req_id, "message": "이미지 저장에 실패했습니다" }),
            );
        }

        "revealInFinder" => {
            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
            let path_opt = {
                let st = state_arc.lock().unwrap();
                st.tabs
                    .iter()
                    .find(|t| t.id == tab_id)
                    .and_then(|t| t.file_path.clone())
            };
            if let Some(p) = path_opt {
                let _ = std::process::Command::new("explorer")
                    .arg(format!("/select,{}", p.to_string_lossy()))
                    .spawn();
            }
        }

        "openWithDefaultApp" => {
            let tab_id = payload.get("tabId").and_then(|v| v.as_str()).unwrap_or("");
            let path_opt = {
                let st = state_arc.lock().unwrap();
                st.tabs
                    .iter()
                    .find(|t| t.id == tab_id)
                    .and_then(|t| t.file_path.clone())
            };
            if let Some(p) = path_opt {
                let _ = open::that(p);
            }
        }

        "openExternal" => {
            if let Some(url) = payload.get("url").and_then(|v| v.as_str()) {
                let _ = open::that(url);
            }
        }

        "copyText" | "copyRich" => {
            if let Some(text) = payload
                .get("text")
                .or_else(|| payload.get("plain"))
                .and_then(|v| v.as_str())
            {
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    let _ = cb.set_text(text.to_string());
                }
            }
        }

        "toggleAutoSave" => {
            if let Some(enabled) = payload.get("enabled").and_then(|v| v.as_bool()) {
                let mut st = state_arc.lock().unwrap();
                st.settings.auto_save = enabled;
                st.save_settings();
            }
        }

        "saveSettings" => {
            let mut st = state_arc.lock().unwrap();
            if let Some(v) = payload.get("themeId").and_then(|v| v.as_str()) {
                st.settings.theme_id = v.to_string();
            }
            if let Some(v) = payload.get("accentId").and_then(|v| v.as_str()) {
                st.settings.accent_id = v.to_string();
            }
            if let Some(v) = payload.get("fontSize").and_then(|v| v.as_f64()) {
                st.settings.font_size = v;
            }
            if let Some(v) = payload.get("narrowWidth").and_then(|v| v.as_bool()) {
                st.settings.narrow_width = v;
            }
            if let Some(v) = payload.get("autoSave").and_then(|v| v.as_bool()) {
                st.settings.auto_save = v;
            }
            st.save_settings();
        }

        "pickDefaultVault" => {
            let app_clone = app.clone();
            let state_clone = state_arc.clone();
            std::thread::spawn(move || {
                if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                    let norm = norm_path(&dir);
                    let snapshot = {
                        let mut st = state_clone.lock().unwrap();
                        st.settings.default_vault_path = norm;
                        st.save_settings();
                        st.settings.clone()
                    };
                    call_web_js(
                        &app_clone,
                        "applySettings",
                        &json!({ "defaultVaultPath": snapshot.default_vault_path }),
                    );
                }
            });
        }

        "clearDefaultVault" => {
            let mut st = state_arc.lock().unwrap();
            st.settings.default_vault_path.clear();
            st.save_settings();
            drop(st);
            call_web_js(&app, "applySettings", &json!({ "defaultVaultPath": "" }));
        }

        "openPeriodicNote" => {
            let kind = payload.get("kind").and_then(|v| v.as_str()).unwrap_or("daily");
            let vault_root = {
                let st = state_arc.lock().unwrap();
                if !st.settings.default_vault_path.is_empty() {
                    Some(PathBuf::from(&st.settings.default_vault_path))
                } else {
                    st.active_tab_id
                        .as_deref()
                        .and_then(|id| st.tabs.iter().find(|t| t.id == id))
                        .and_then(|t| t.file_path.as_deref())
                        .and_then(|p| p.parent())
                        .and_then(find_vault_root)
                }
            };
            if let Some(root) = vault_root {
                if let Some(target) = resolve_periodic_note_path(kind, &root) {
                    if target.is_file() {
                        open_file_in_tab(&app, &state_arc, target, None);
                    } else {
                        call_web_js(
                            &app,
                            "showToast",
                            &json!({ "message": format!("주기 노트 파일이 아직 없습니다: {}", target.file_name().unwrap_or_default().to_string_lossy()) }),
                        );
                    }
                }
            } else {
                call_web_js(
                    &app,
                    "showToast",
                    &json!({ "message": "설정(Ctrl+,)에서 기본 볼트 폴더를 먼저 지정하세요" }),
                );
            }
        }

        "refreshAll" => {
            call_web_js(&app, "refreshFileTree", &json!(false));
        }

        "checkForUpdates" => {
            check_updates_async(app, state_arc, true);
        }

        "installUpdate" | "openReleaseNotes" => {
            let url = {
                let st = state_arc.lock().unwrap();
                st.latest_release_url
                    .clone()
                    .unwrap_or_else(|| "https://github.com/SheepCastle/emdi/releases/latest".to_string())
            };
            let _ = open::that(url);
        }

        _ => {}
    }
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (it.next(), it.next()) {
            let val = urlencoding::decode(v)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| v.to_string());
            map.insert(k.to_string(), val);
        }
    }
    map
}

fn main() {
    let initial_args: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
    let settings = AppState::load_settings();
    let shared_state = Arc::new(Mutex::new(AppState {
        settings,
        tabs: Vec::new(),
        active_tab_id: None,
        closed_history: Vec::new(),
        tab_seq: 0,
        initial_args,
        latest_release_url: None,
    }));

    let proto_state = shared_state.clone();

    tauri::Builder::default()
        .manage(shared_state)
        .invoke_handler(tauri::generate_handler![emdi_message])
        .register_uri_scheme_protocol("emdi-local", move |_ctx, req| {
            let uri = req.uri();
            let params = parse_query(uri.query().unwrap_or(""));
            let raw_path = params.get("path").cloned().unwrap_or_default();
            let tab_id = params.get("tabId").cloned().unwrap_or_default();

            let (base_file, default_vault) = {
                let st = proto_state.lock().unwrap();
                let base = st
                    .tabs
                    .iter()
                    .find(|t| t.id == tab_id)
                    .and_then(|t| t.file_path.clone());
                let vault = if st.settings.default_vault_path.is_empty() {
                    None
                } else {
                    Some(PathBuf::from(&st.settings.default_vault_path))
                };
                (base, vault)
            };

            let resolved = resolve_local_target(
                &raw_path,
                base_file.as_deref(),
                default_vault.as_deref(),
                false,
            )
            .map(|(p, _)| p);

            if let Some(file_path) = resolved {
                if let Ok(bytes) = fs::read(&file_path) {
                    let mime = mime_for_path(&file_path);
                    return tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .unwrap();
                }
            }

            tauri::http::Response::builder()
                .status(404)
                .header("Content-Type", "text/plain; charset=utf-8")
                .body(b"Not Found".to_vec())
                .unwrap()
        })
        .run(tauri::generate_context!())
        .expect("error while running emdi for Windows");
}
