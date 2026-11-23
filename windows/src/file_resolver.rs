use chrono::{Datelike, Local};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNodeItem {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel_path: Option<String>,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub file_kind: String,
    pub ext: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeChildrenPayload {
    pub request_id: String,
    pub dir_name: String,
    pub dir_path: String,
    pub parent_path: String,
    pub vault_root_path: String,
    pub items: Vec<TreeNodeItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeSearchPayload {
    pub request_id: String,
    pub target: String,
    pub query: String,
    pub items: Vec<TreeNodeItem>,
}

pub fn norm_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub fn ext_lower(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

pub fn classify_file_kind(p: &Path, is_dir: bool) -> &'static str {
    if is_dir {
        return "dir";
    }
    match ext_lower(p).as_str() {
        "md" | "markdown" | "mdown" | "mkd" => "markdown",
        "html" | "htm" => "html",
        "pdf" => "pdf",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => "image",
        "js" | "ts" | "jsx" | "tsx" | "mjs" | "cjs" | "py" | "rs" | "swift" | "go" | "java"
        | "kt" | "c" | "cpp" | "h" | "hpp" | "cs" | "rb" | "php" | "sh" | "bash" | "zsh"
        | "ps1" | "sql" | "json" | "yaml" | "yml" | "toml" | "xml" | "css" | "scss" | "less"
        | "csv" | "tsv" | "dockerfile" | "makefile" => "code",
        "txt" | "log" | "env" | "ini" | "cfg" | "conf" | "gitignore" => "text",
        _ => "external",
    }
}

pub fn can_open_in_tab(p: &Path) -> bool {
    !p.is_dir() && classify_file_kind(p, false) != "external"
}

pub fn mime_for_path(p: &Path) -> &'static str {
    match ext_lower(p).as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "txt" | "md" | "markdown" | "csv" | "tsv" | "yaml" | "yml" | "toml" => {
            "text/plain; charset=utf-8"
        }
        _ => "application/octet-stream",
    }
}

pub fn find_vault_root(start_dir: &Path) -> Option<PathBuf> {
    let mut cur = start_dir.to_path_buf();
    for _ in 0..16 {
        if cur.join(".obsidian").is_dir() {
            return Some(cur);
        }
        if !cur.pop() {
            break;
        }
    }
    None
}

fn should_skip_entry(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name,
        "node_modules" | "target" | ".git" | "__pycache__" | "dist" | "build" | "$RECYCLE.BIN"
    )
}

pub fn list_tree_children(
    dir_path: &Path,
    only_markdown: bool,
    request_id: String,
) -> TreeChildrenPayload {
    let vault_root = find_vault_root(dir_path)
        .map(|p| norm_path(&p))
        .unwrap_or_default();
    let dir_name = dir_path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| norm_path(dir_path));
    let parent_path = dir_path
        .parent()
        .map(norm_path)
        .unwrap_or_default();

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if should_skip_entry(&name) {
                continue;
            }
            let path = entry.path();
            let is_dir = path.is_dir();
            let kind = classify_file_kind(&path, is_dir);
            let is_md = kind == "markdown";
            if only_markdown && !is_dir && !is_md {
                continue;
            }
            let item = TreeNodeItem {
                name,
                path: norm_path(&path),
                rel_path: None,
                is_dir,
                is_markdown: is_md,
                file_kind: kind.to_string(),
                ext: if is_dir { String::new() } else { ext_lower(&path) },
            };
            if is_dir {
                dirs.push(item);
            } else {
                files.push(item);
            }
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);

    TreeChildrenPayload {
        request_id,
        dir_name,
        dir_path: norm_path(dir_path),
        parent_path,
        vault_root_path: vault_root,
        items: dirs,
    }
}

pub fn search_tree_files(
    root_path: &Path,
    query: &str,
    only_markdown: bool,
    target: String,
    request_id: String,
) -> TreeSearchPayload {
    let q = query.trim().to_lowercase();
    let mut results = Vec::new();
    let mut stack = vec![(root_path.to_path_buf(), 0usize)];
    let root_norm = norm_path(root_path);
    let prefix = if root_norm.ends_with('/') {
        root_norm.clone()
    } else {
        format!("{}/", root_norm)
    };

    while let Some((dir, depth)) = stack.pop() {
        if depth > 10 || results.len() >= 120 {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if should_skip_entry(&name) {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                stack.push((path, depth + 1));
                continue;
            }
            let kind = classify_file_kind(&path, false);
            let is_md = kind == "markdown";
            if only_markdown && !is_md {
                continue;
            }
            let full_norm = norm_path(&path);
            let rel = full_norm
                .strip_prefix(&prefix)
                .unwrap_or(&name)
                .to_string();
            if q.is_empty()
                || name.to_lowercase().contains(&q)
                || rel.to_lowercase().contains(&q)
            {
                results.push(TreeNodeItem {
                    name,
                    path: full_norm,
                    rel_path: Some(rel),
                    is_dir: false,
                    is_markdown: is_md,
                    file_kind: kind.to_string(),
                    ext: ext_lower(&path),
                });
                if results.len() >= 120 {
                    break;
                }
            }
        }
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    TreeSearchPayload {
        request_id,
        target,
        query: query.to_string(),
        items: results,
    }
}

pub fn resolve_local_target(
    raw_target: &str,
    base_file: Option<&Path>,
    default_vault: Option<&Path>,
    is_wiki: bool,
) -> Option<(PathBuf, Option<String>)> {
    let cleaned = raw_target.split('|').next().unwrap_or(raw_target).trim();
    let mut parts = cleaned.splitn(2, '#');
    let path_part = parts.next().unwrap_or("").trim();
    let anchor = parts
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if path_part.is_empty() {
        return None;
    }

    let decoded = urlencoding::decode(path_part)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| path_part.to_string());

    let candidate_direct = PathBuf::from(&decoded);
    if candidate_direct.is_absolute() && candidate_direct.exists() {
        return Some((candidate_direct, anchor));
    }

    let base_dir = base_file.and_then(|p| p.parent());
    if let Some(dir) = base_dir {
        let rel = dir.join(&decoded);
        if rel.is_file() {
            return Some((rel, anchor));
        }
        if is_wiki {
            let rel_md = dir.join(format!("{}.md", decoded));
            if rel_md.is_file() {
                return Some((rel_md, anchor));
            }
        }
    }

    let vault_root = base_dir
        .and_then(find_vault_root)
        .or_else(|| default_vault.map(|p| p.to_path_buf()));

    if let Some(root) = vault_root {
        let direct = root.join(&decoded);
        if direct.is_file() {
            return Some((direct, anchor));
        }
        let direct_md = root.join(format!("{}.md", decoded));
        if direct_md.is_file() {
            return Some((direct_md, anchor));
        }

        // Shallow vault-wide filename lookup for wikilinks / images
        let target_name = Path::new(&decoded)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&decoded)
            .to_lowercase();
        let target_md = if target_name.ends_with(".md") {
            target_name.clone()
        } else {
            format!("{}.md", target_name)
        };

        let mut stack = vec![(root, 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if depth > 8 {
                continue;
            }
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if should_skip_entry(&name) {
                    continue;
                }
                let p = entry.path();
                if p.is_dir() {
                    stack.push((p, depth + 1));
                } else {
                    let low = name.to_lowercase();
                    if low == target_name || (is_wiki && low == target_md) {
                        return Some((p, anchor));
                    }
                }
            }
        }
    }

    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataviewNoteRecord {
    pub name: String,
    pub path: String,
    pub folder: String,
    pub ctime: String,
    pub mtime: String,
    pub props: std::collections::HashMap<String, serde_json::Value>,
}

fn strip_quotes(s: &str) -> String {
    let t = s.trim();
    if (t.starts_with('"') && t.ends_with('"') && t.len() >= 2)
        || (t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2)
    {
        t[1..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

fn parse_simple_yaml_frontmatter(content: &str) -> std::collections::HashMap<String, serde_json::Value> {
    let mut props = std::collections::HashMap::new();
    if !(content.starts_with("---\n") || content.starts_with("---\r\n")) {
        return props;
    }

    let mut current_arr_key: Option<String> = None;
    let mut current_arr: Vec<serde_json::Value> = Vec::new();

    for (idx, raw_line) in content.lines().enumerate() {
        if idx == 0 {
            continue;
        }
        if idx > 120 {
            break;
        }
        let trimmed = raw_line.trim();
        if trimmed == "---" || trimmed == "..." {
            if let Some(k) = current_arr_key.take() {
                props.insert(k, serde_json::Value::Array(std::mem::take(&mut current_arr)));
            }
            break;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- ") {
            if current_arr_key.is_some() {
                let item = strip_quotes(rest);
                if !item.is_empty() {
                    current_arr.push(serde_json::Value::String(item));
                }
                continue;
            }
        }
        if let Some(colon) = raw_line.find(':') {
            if let Some(k) = current_arr_key.take() {
                props.insert(k, serde_json::Value::Array(std::mem::take(&mut current_arr)));
            }
            let key = raw_line[..colon].trim().to_string();
            if key.is_empty() {
                continue;
            }
            let val_part = raw_line[colon + 1..].trim();
            if val_part.is_empty() {
                current_arr_key = Some(key);
                current_arr.clear();
            } else if val_part.starts_with('[') && val_part.ends_with(']') && val_part.len() >= 2 {
                let inner = &val_part[1..val_part.len() - 1];
                let items: Vec<serde_json::Value> = inner
                    .split(',')
                    .map(strip_quotes)
                    .filter(|s| !s.is_empty())
                    .map(serde_json::Value::String)
                    .collect();
                props.insert(key, serde_json::Value::Array(items));
            } else {
                props.insert(key, serde_json::Value::String(strip_quotes(val_part)));
            }
        }
    }

    if let Some(k) = current_arr_key.take() {
        props.insert(k, serde_json::Value::Array(current_arr));
    }
    props
}

pub fn query_dataview_folder(
    from: &str,
    base_file: Option<&Path>,
    default_vault: Option<&Path>,
) -> Vec<DataviewNoteRecord> {
    let base_dir = base_file.and_then(|p| p.parent());
    let vault_root = base_dir
        .and_then(find_vault_root)
        .or_else(|| default_vault.map(|p| p.to_path_buf()));

    let cleaned = from.trim().trim_matches(|c| c == '"' || c == '\'' || c == '/');
    let target_dir = if !cleaned.is_empty() {
        vault_root
            .as_ref()
            .map(|r| r.join(cleaned))
            .filter(|p| p.is_dir())
            .or_else(|| base_dir.map(|d| d.join(cleaned)).filter(|p| p.is_dir()))
    } else {
        base_dir.map(|d| d.to_path_buf()).or(vault_root)
    };

    let Some(dir) = target_dir else {
        return Vec::new();
    };

    let mut results = Vec::new();
    let mut stack = vec![(dir, 0usize)];

    while let Some((cur, depth)) = stack.pop() {
        if depth > 10 || results.len() >= 300 {
            continue;
        }
        let Ok(entries) = fs::read_dir(&cur) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if should_skip_entry(&name) {
                continue;
            }
            let p = entry.path();
            if p.is_dir() {
                stack.push((p, depth + 1));
                continue;
            }
            let ext = ext_lower(&p);
            if ext != "md" && ext != "markdown" {
                continue;
            }

            let head = fs::read_to_string(&p)
                .map(|s| s.chars().take(4096).collect::<String>())
                .unwrap_or_default();
            let props = parse_simple_yaml_frontmatter(&head);

            let mtime = fs::metadata(&p)
                .and_then(|m| m.modified())
                .map(|t| chrono::DateTime::<Local>::from(t).format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            let ctime = fs::metadata(&p)
                .and_then(|m| m.created())
                .map(|t| chrono::DateTime::<Local>::from(t).format("%Y-%m-%d").to_string())
                .unwrap_or_default();

            let stem = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&name)
                .to_string();
            let folder = p
                .parent()
                .and_then(|d| d.file_name())
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            results.push(DataviewNoteRecord {
                name: stem,
                path: norm_path(&p),
                folder,
                ctime,
                mtime,
                props,
            });
            if results.len() >= 300 {
                break;
            }
        }
    }

    results
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkItem {
    pub name: String,
    pub path: String,
    pub rel_path: String,
    pub snippet: String,
}

pub fn find_backlinks(file_path: &Path) -> Vec<BacklinkItem> {
    let stem = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    if stem.is_empty() {
        return Vec::new();
    }

    let Some(parent_dir) = file_path.parent() else {
        return Vec::new();
    };
    let search_root = find_vault_root(parent_dir).unwrap_or_else(|| parent_dir.to_path_buf());
    let root_norm = norm_path(&search_root);
    let prefix = if root_norm.ends_with('/') {
        root_norm.clone()
    } else {
        format!("{}/", root_norm)
    };
    let self_norm = norm_path(file_path).to_lowercase();
    let needle_lower = format!("[[{}", stem.to_lowercase());

    let mut results = Vec::new();
    let mut stack = vec![(search_root, 0usize)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > 10 || results.len() >= 40 {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if should_skip_entry(&name) {
                continue;
            }
            let p = entry.path();
            if p.is_dir() {
                stack.push((p, depth + 1));
                continue;
            }
            let ext = ext_lower(&p);
            if ext != "md" && ext != "markdown" {
                continue;
            }
            let cand_norm = norm_path(&p);
            if cand_norm.to_lowercase() == self_norm {
                continue;
            }
            let Ok(content) = fs::read_to_string(&p) else {
                continue;
            };

            let mut matched_snippet: Option<String> = None;
            for line in content.lines() {
                let low = line.to_lowercase();
                if let Some(pos) = low.find(&needle_lower) {
                    let after = &low[pos + needle_lower.len()..];
                    if after.starts_with("]]") || after.starts_with('|') || after.starts_with('#') {
                        let trimmed = line.trim();
                        let snippet: String = trimmed.chars().take(140).collect();
                        matched_snippet = Some(snippet);
                        break;
                    }
                }
            }

            if let Some(snippet) = matched_snippet {
                let rel_path = cand_norm
                    .strip_prefix(&prefix)
                    .unwrap_or(&name)
                    .to_string();
                let doc_name = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&name)
                    .to_string();
                results.push(BacklinkItem {
                    name: doc_name,
                    path: cand_norm,
                    rel_path,
                    snippet,
                });
                if results.len() >= 40 {
                    break;
                }
            }
        }
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    results
}

pub fn resolve_periodic_note_path(
    kind: &str,
    vault_root: &Path,
) -> Option<PathBuf> {
    let now = Local::now();
    let (default_folder, file_stem) = match kind {
        "daily" => ("daily", now.format("%Y-%m-%d").to_string()),
        "weekly" => {
            let iso = now.iso_week();
            ("weekly", format!("{}-W{:02}", iso.year(), iso.week()))
        }
        "monthly" => ("monthly", now.format("%Y-%m").to_string()),
        "yearly" => ("yearly", now.format("%Y").to_string()),
        _ => return None,
    };

    let mut folder_rel = default_folder.to_string();
    let periodic_cfg = vault_root.join(".obsidian/plugins/periodic-notes/data.json");
    if let Ok(raw) = fs::read_to_string(&periodic_cfg) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(f) = json
                .get(kind)
                .and_then(|s| s.get("folder"))
                .and_then(|v| v.as_str())
            {
                let trimmed = f.trim();
                if !trimmed.is_empty() {
                    folder_rel = trimmed.to_string();
                }
            }
        }
    }

    let folder = vault_root.join(folder_rel);
    let expected = folder.join(format!("{}.md", file_stem));
    if expected.is_file() {
        return Some(expected);
    }

    // Fallback: latest markdown file in that periodic folder
    if let Ok(entries) = fs::read_dir(&folder) {
        let mut md_files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file() && ext_lower(p) == "md")
            .collect();
        md_files.sort();
        if let Some(last) = md_files.pop() {
            return Some(last);
        }
    }

    Some(expected)
}
