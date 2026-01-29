

use crate::models;
use crate::modules;
use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn list_accounts() -> Result<Vec<models::Account>, String> {
    modules::list_accounts()
}

/// 从插件共享目录同步账号（credentials.json）
#[tauri::command]
pub async fn sync_from_extension() -> Result<usize, String> {
    modules::import::import_from_extension_credentials().await
}

#[tauri::command]
pub async fn add_account(
    refresh_token: String,
) -> Result<models::Account, String> {
    let token_res = modules::oauth::refresh_access_token(&refresh_token).await?;
    let user_info = modules::oauth::get_user_info(&token_res.access_token).await?;

    let token = models::TokenData::new(
        token_res.access_token,
        refresh_token,
        token_res.expires_in,
        Some(user_info.email.clone()),
        None,
        None,
    );

    let account = modules::upsert_account(user_info.email.clone(), user_info.get_display_name(), token)?;
    modules::logger::log_info(&format!("添加账号成功: {}", account.email));

    // 广播通知
    modules::websocket::broadcast_data_changed("account_added");

    Ok(account)
}

#[tauri::command]
pub async fn delete_account(account_id: String) -> Result<(), String> {
    modules::delete_account(&account_id)?;
    modules::websocket::broadcast_data_changed("account_deleted");
    Ok(())
}

#[tauri::command]
pub async fn delete_accounts(account_ids: Vec<String>) -> Result<(), String> {
    modules::delete_accounts(&account_ids)?;
    modules::websocket::broadcast_data_changed("accounts_deleted");
    Ok(())
}

#[tauri::command]
pub async fn reorder_accounts(account_ids: Vec<String>) -> Result<(), String> {
    modules::reorder_accounts(&account_ids)
}

#[tauri::command]
pub async fn get_current_account() -> Result<Option<models::Account>, String> {
    modules::get_current_account()
}

#[tauri::command]
pub async fn set_current_account(app: tauri::AppHandle, account_id: String) -> Result<(), String> {
    modules::set_current_account_id(&account_id)?;
    let _ = crate::modules::tray::update_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn fetch_account_quota(account_id: String) -> AppResult<models::QuotaData> {
    let mut account = modules::load_account(&account_id).map_err(AppError::Account)?;
    let quota = modules::fetch_quota_with_retry(&mut account).await?;
    modules::update_account_quota(&account_id, quota.clone()).map_err(AppError::Account)?;
    Ok(quota)
}

#[tauri::command]
pub async fn refresh_all_quotas(app: tauri::AppHandle) -> Result<modules::account::RefreshStats, String> {
    let result = modules::account::refresh_all_quotas_logic().await;
    if result.is_ok() {
        let _ = crate::modules::tray::update_tray_menu(&app);
    }
    result
}

#[tauri::command]
pub async fn refresh_current_quota(app: tauri::AppHandle) -> Result<(), String> {
    let Some(account) = modules::get_current_account().map_err(|e| e.to_string())? else {
        return Err("未找到当前账号".to_string());
    };
    let mut account = account;
    let quota = modules::fetch_quota_with_retry(&mut account)
        .await
        .map_err(|e| e.to_string())?;
    modules::update_account_quota(&account.id, quota)
        .map_err(|e| e.to_string())?;
    let _ = crate::modules::tray::update_tray_menu(&app);
    Ok(())
}

/// 切换账号（完整流程：Token刷新 + 关闭程序 + 注入 + 指纹同步 + 重启）
#[tauri::command]
pub async fn switch_account(account_id: String) -> Result<models::Account, String> {
    use std::fs;
    
    modules::logger::log_info(&format!("开始切换账号: {}", account_id));
    
    // 1. 加载并验证账号存在
    let mut account = modules::load_account(&account_id)?;
    modules::logger::log_info(&format!("正在切换到账号: {} (ID: {})", account.email, account.id));
    
    // 2. 确保 Token 有效（自动刷新过期的 Token）
    let fresh_token = modules::oauth::ensure_fresh_token(&account.token).await
        .map_err(|e| format!("Token 刷新失败: {}", e))?;
    
    // 如果 Token 更新了，保存回账号文件
    if fresh_token.access_token != account.token.access_token {
        modules::logger::log_info(&format!("Token 已刷新: {}", account.email));
        account.token = fresh_token.clone();
        modules::save_account(&account)?;
    }
    
    // 3. 关闭 Antigravity（等待最多 20 秒）
    if modules::process::is_antigravity_running() {
        modules::logger::log_info("检测到 Antigravity 正在运行，正在关闭...");
        modules::process::close_antigravity(20)?;
    }
    
    // 4. 写入设备指纹到 storage.json
    if let Ok(storage_path) = modules::device::get_storage_path() {
        if let Some(ref fp_id) = account.fingerprint_id {
            // 优先使用绑定的指纹
            if let Ok(fingerprint) = modules::fingerprint::get_fingerprint(fp_id) {
                modules::logger::log_info(&format!(
                    "写入设备指纹: machineId={}, serviceMachineId={}",
                    fingerprint.profile.machine_id,
                    fingerprint.profile.service_machine_id
                ));
                let _ = modules::device::write_profile(&storage_path, &fingerprint.profile);
                let _ = modules::db::write_service_machine_id(&fingerprint.profile.service_machine_id);
                // 更新当前应用的指纹ID
                let _ = modules::fingerprint::set_current_fingerprint_id(fp_id);
            }
        }
    }
    
    // 5. 备份数据库
    let db_path = modules::db::get_db_path()?;
    if db_path.exists() {
        let backup_path = db_path.with_extension("vscdb.backup");
        if let Err(e) = fs::copy(&db_path, &backup_path) {
            modules::logger::log_warn(&format!("备份数据库失败: {}", e));
        } else {
            modules::logger::log_info("数据库已备份");
        }
    }
    
    // 6. 注入 Token 到 Antigravity 数据库
    modules::logger::log_info("正在注入 Token 到数据库...");
    modules::db::inject_token(
        &account.token.access_token,
        &account.token.refresh_token,
        account.token.expiry_timestamp,
    ).map_err(|e| {
        modules::logger::log_error(&format!("Token 注入失败: {}", e));
        e
    })?;
    
    // 7. 更新工具内部状态
    modules::set_current_account_id(&account_id)?;
    account.update_last_used();
    modules::save_account(&account)?;
    
    // 8. 重启 Antigravity
    modules::logger::log_info("正在重启 Antigravity...");
    if let Err(e) = modules::process::start_antigravity() {
        modules::logger::log_warn(&format!("Antigravity 启动失败: {}", e));
        // 不中断流程，允许用户手动启动
    }
    
    modules::logger::log_info(&format!("账号切换完成: {}", account.email));
    
    // 广播切换完成通知
    modules::websocket::broadcast_account_switched(&account.id, &account.email);
    
    Ok(account)
}

#[tauri::command]
pub async fn bind_account_fingerprint(account_id: String, fingerprint_id: String) -> Result<(), String> {
    let mut account = modules::load_account(&account_id)?;
    // 验证指纹存在
    let _ = modules::fingerprint::get_fingerprint(&fingerprint_id)?;
    account.fingerprint_id = Some(fingerprint_id);
    modules::save_account(&account)
}

#[tauri::command]
pub async fn update_account_tags(account_id: String, tags: Vec<String>) -> Result<models::Account, String> {
    let account = modules::update_account_tags(&account_id, tags)?;
    modules::websocket::broadcast_data_changed("account_tags_updated");
    Ok(account)
}

#[tauri::command]
pub async fn get_bound_accounts(fingerprint_id: String) -> Result<Vec<models::Account>, String> {
    modules::fingerprint::get_bound_accounts(&fingerprint_id)
}

/// 从本地客户端同步当前账号状态
/// 读取本地 state.vscdb 中的 refresh_token，与 Tools 账号列表对比
/// 如匹配账号与当前账号不同，则静默更新 current_account_id
#[tauri::command]
pub async fn sync_current_from_client() -> Result<Option<String>, String> {
    use base64::{engine::general_purpose, Engine as _};
    
    // 读取本地数据库中的 refresh_token
    let db_path = modules::db::get_db_path()?;
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("打开数据库失败: {}", e))?;
    
    let state_data: Result<String, _> = conn.query_row(
        "SELECT value FROM ItemTable WHERE key = ?",
        ["jetskiStateSync.agentManagerInitState"],
        |row| row.get(0),
    );
    
    let state_data = match state_data {
        Ok(data) => data,
        Err(_) => {
            // 未找到登录状态，可能客户端未登录
            return Ok(None);
        }
    };
    
    // Base64 解码
    let blob = general_purpose::STANDARD
        .decode(&state_data)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
    
    // 提取 refresh_token
    let local_refresh_token = match crate::utils::protobuf::extract_refresh_token(&blob) {
        Some(token) if !token.is_empty() => token,
        _ => return Ok(None),
    };
    
    // 获取当前 Tools 记录的账号 ID
    let current_account_id = modules::get_current_account_id().ok().flatten();
    
    // 遍历账号列表，查找匹配的 refresh_token
    let accounts = modules::list_accounts()?;
    
    for account in &accounts {
        if account.token.refresh_token == local_refresh_token {
            // 找到匹配账号
            if current_account_id.as_ref() != Some(&account.id) {
                // 当前账号不一致，静默更新
                modules::logger::log_info(&format!(
                    "[SyncClient] 检测到客户端账号变更，同步至: {}",
                    account.email
                ));
                modules::set_current_account_id(&account.id)?;
                return Ok(Some(account.id.clone()));
            } else {
                // 已经是当前账号，无需操作
                return Ok(None);
            }
        }
    }
    
    // 未找到匹配账号（可能是新账号，未导入到 Tools）
    modules::logger::log_info("[SyncClient] 本地客户端账号未在 Tools 中找到");
    Ok(None)
}
