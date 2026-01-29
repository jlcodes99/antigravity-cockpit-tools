use tauri::AppHandle;
use crate::models::codex::{CodexAccount, CodexQuota, CodexTokens};
use crate::modules::{codex_account, codex_quota, codex_oauth, logger, process};

/// 列出所有 Codex 账号
#[tauri::command]
pub fn list_codex_accounts() -> Result<Vec<CodexAccount>, String> {
    Ok(codex_account::list_accounts())
}

/// 获取当前激活的 Codex 账号
#[tauri::command]
pub fn get_current_codex_account() -> Result<Option<CodexAccount>, String> {
    Ok(codex_account::get_current_account())
}

/// 切换 Codex 账号（包含 token 刷新检查）
#[tauri::command]
pub async fn switch_codex_account(app: AppHandle, account_id: String) -> Result<CodexAccount, String> {
    let mut account = codex_account::load_account(&account_id)
        .ok_or_else(|| format!("账号不存在: {}", account_id))?;
    
    // 检查 token 是否过期，如果过期则刷新
    if codex_oauth::is_token_expired(&account.tokens.access_token) {
        logger::log_info(&format!("账号 {} 的 Token 已过期，尝试刷新", account.email));
        
        if let Some(ref refresh_token) = account.tokens.refresh_token {
            match codex_oauth::refresh_access_token(refresh_token).await {
                Ok(new_tokens) => {
                    logger::log_info(&format!("账号 {} 的 Token 刷新成功", account.email));
                    account.tokens = new_tokens;
                    codex_account::save_account(&account)?;
                }
                Err(e) => {
                    logger::log_error(&format!("账号 {} Token 刷新失败: {}", account.email, e));
                    return Err(format!("Token 已过期且刷新失败: {}", e));
                }
            }
        } else {
            return Err("Token 已过期且无 refresh_token，请重新登录".to_string());
        }
    }
    
    // 切换账号（写入 auth.json）
    let account = codex_account::switch_account(&account_id)?;
    let _ = crate::modules::tray::update_tray_menu(&app);
    Ok(account)
}

/// 删除 Codex 账号
#[tauri::command]
pub fn delete_codex_account(account_id: String) -> Result<(), String> {
    codex_account::remove_account(&account_id)
}

/// 批量删除 Codex 账号
#[tauri::command]
pub fn delete_codex_accounts(account_ids: Vec<String>) -> Result<(), String> {
    codex_account::remove_accounts(&account_ids)
}

/// 从本地 auth.json 导入账号
#[tauri::command]
pub fn import_codex_from_local() -> Result<CodexAccount, String> {
    codex_account::import_from_local()
}

/// 从 JSON 字符串导入账号
#[tauri::command]
pub fn import_codex_from_json(json_content: String) -> Result<Vec<CodexAccount>, String> {
    codex_account::import_from_json(&json_content)
}

/// 导出 Codex 账号
#[tauri::command]
pub fn export_codex_accounts(account_ids: Vec<String>) -> Result<String, String> {
    codex_account::export_accounts(&account_ids)
}

/// 刷新单个账号配额
#[tauri::command]
pub async fn refresh_codex_quota(app: AppHandle, account_id: String) -> Result<CodexQuota, String> {
    let result = codex_quota::refresh_account_quota(&account_id).await;
    if result.is_ok() {
        let _ = crate::modules::tray::update_tray_menu(&app);
    }
    result
}

#[tauri::command]
pub async fn refresh_current_codex_quota(app: AppHandle) -> Result<(), String> {
    let Some(account) = codex_account::get_current_account() else {
        return Err("未找到当前 Codex 账号".to_string());
    };
    let result = codex_quota::refresh_account_quota(&account.id).await;
    if result.is_ok() {
        let _ = crate::modules::tray::update_tray_menu(&app);
        Ok(())
    } else {
        Err(result.err().unwrap_or_else(|| "刷新 Codex 配额失败".to_string()))
    }
}

/// 刷新所有账号配额
#[tauri::command]
pub async fn refresh_all_codex_quotas(app: AppHandle) -> Result<i32, String> {
    let results = codex_quota::refresh_all_quotas().await?;
    let success_count = results.iter().filter(|(_, r)| r.is_ok()).count();
    let _ = crate::modules::tray::update_tray_menu(&app);
    Ok(success_count as i32)
}

/// 准备 OAuth URL
#[tauri::command]
pub async fn prepare_codex_oauth_url(app_handle: AppHandle) -> Result<String, String> {
    codex_oauth::prepare_oauth_url(app_handle).await
}

/// 用授权码换取 Token 并添加账号
#[tauri::command]
pub async fn complete_codex_oauth(code: String) -> Result<CodexAccount, String> {
    logger::log_info(&format!("Codex OAuth 完成授权，code: {}...", &code[..code.len().min(10)]));
    
    let tokens = codex_oauth::exchange_code_for_token(&code).await?;
    let account = codex_account::upsert_account(tokens)?;
    
    // 刷新配额
    if let Err(e) = codex_quota::refresh_account_quota(&account.id).await {
        logger::log_error(&format!("刷新配额失败: {}", e));
    }
    
    // 重新加载账号以获取配额
    codex_account::load_account(&account.id)
        .ok_or_else(|| "账号保存后无法读取".to_string())
}

/// 取消 OAuth 流程
#[tauri::command]
pub fn cancel_codex_oauth() -> Result<(), String> {
    codex_oauth::cancel_oauth_flow();
    Ok(())
}

/// 通过 Token 添加账号
#[tauri::command]
pub async fn add_codex_account_with_token(id_token: String, access_token: String, refresh_token: Option<String>) -> Result<CodexAccount, String> {
    let tokens = CodexTokens {
        id_token,
        access_token,
        refresh_token,
    };
    
    let account = codex_account::upsert_account(tokens)?;
    
    // 刷新配额
    if let Err(e) = codex_quota::refresh_account_quota(&account.id).await {
        logger::log_error(&format!("刷新配额失败: {}", e));
    }
    
    codex_account::load_account(&account.id)
        .ok_or_else(|| "账号保存后无法读取".to_string())
}

/// 检查 Codex OAuth 端口是否被占用
#[tauri::command]
pub async fn update_codex_account_tags(account_id: String, tags: Vec<String>) -> Result<CodexAccount, String> {
    codex_account::update_account_tags(&account_id, tags)
}

#[tauri::command]
pub fn is_codex_oauth_port_in_use() -> Result<bool, String> {
    let port = codex_oauth::get_callback_port();
    process::is_port_in_use(port)
}

/// 关闭占用 Codex OAuth 端口的进程
#[tauri::command]
pub fn close_codex_oauth_port() -> Result<u32, String> {
    let port = codex_oauth::get_callback_port();
    let killed = process::kill_port_processes(port)?;
    Ok(killed as u32)
}
