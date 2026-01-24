use std::fs;
use std::path::PathBuf;
use uuid::Uuid;
use serde::Serialize;
use std::sync::Mutex;

use crate::models::{Account, AccountIndex, AccountSummary, TokenData, QuotaData, DeviceProfile, DeviceProfileVersion};
use crate::modules;

static ACCOUNT_INDEX_LOCK: std::sync::LazyLock<Mutex<()>> = std::sync::LazyLock::new(|| Mutex::new(()));

// 使用与 AntigravityCockpit 插件相同的数据目录
const DATA_DIR: &str = ".antigravity_cockpit";
const ACCOUNTS_INDEX: &str = "accounts.json";
const ACCOUNTS_DIR: &str = "accounts";

/// 获取数据目录路径
pub fn get_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let data_dir = home.join(DATA_DIR);
    
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("创建数据目录失败: {}", e))?;
    }
    
    Ok(data_dir)
}

/// 获取账号目录路径
pub fn get_accounts_dir() -> Result<PathBuf, String> {
    let data_dir = get_data_dir()?;
    let accounts_dir = data_dir.join(ACCOUNTS_DIR);
    
    if !accounts_dir.exists() {
        fs::create_dir_all(&accounts_dir)
            .map_err(|e| format!("创建账号目录失败: {}", e))?;
    }
    
    Ok(accounts_dir)
}

/// 加载账号索引
pub fn load_account_index() -> Result<AccountIndex, String> {
    let data_dir = get_data_dir()?;
    let index_path = data_dir.join(ACCOUNTS_INDEX);
    
    if !index_path.exists() {
        return Ok(AccountIndex::new());
    }
    
    let content = fs::read_to_string(&index_path)
        .map_err(|e| format!("读取账号索引失败: {}", e))?;
    
    if content.trim().is_empty() {
        return Ok(AccountIndex::new());
    }
    
    serde_json::from_str(&content)
        .map_err(|e| format!("解析账号索引失败: {}", e))
}

/// 保存账号索引
pub fn save_account_index(index: &AccountIndex) -> Result<(), String> {
    let data_dir = get_data_dir()?;
    let index_path = data_dir.join(ACCOUNTS_INDEX);
    let temp_path = data_dir.join(format!("{}.tmp", ACCOUNTS_INDEX));
    
    let content = serde_json::to_string_pretty(index)
        .map_err(|e| format!("序列化账号索引失败: {}", e))?;
    
    fs::write(&temp_path, content)
        .map_err(|e| format!("写入临时索引文件失败: {}", e))?;
        
    fs::rename(temp_path, index_path)
        .map_err(|e| format!("替换索引文件失败: {}", e))
}

/// 加载账号数据
pub fn load_account(account_id: &str) -> Result<Account, String> {
    let accounts_dir = get_accounts_dir()?;
    let account_path = accounts_dir.join(format!("{}.json", account_id));
    
    if !account_path.exists() {
        return Err(format!("账号不存在: {}", account_id));
    }
    
    let content = fs::read_to_string(&account_path)
        .map_err(|e| format!("读取账号数据失败: {}", e))?;
    
    serde_json::from_str(&content)
        .map_err(|e| format!("解析账号数据失败: {}", e))
}

/// 保存账号数据
pub fn save_account(account: &Account) -> Result<(), String> {
    let accounts_dir = get_accounts_dir()?;
    let account_path = accounts_dir.join(format!("{}.json", account.id));
    
    let content = serde_json::to_string_pretty(account)
        .map_err(|e| format!("序列化账号数据失败: {}", e))?;
    
    fs::write(&account_path, content)
        .map_err(|e| format!("保存账号数据失败: {}", e))
}

/// 列出所有账号
pub fn list_accounts() -> Result<Vec<Account>, String> {
    modules::logger::log_info("开始列出账号...");
    let index = load_account_index()?;
    let mut accounts = Vec::new();
    
    for summary in &index.accounts {
        match load_account(&summary.id) {
            Ok(mut account) => {
                let _ = modules::quota_cache::apply_cached_quota(&mut account, "authorized");
                accounts.push(account);
            },
            Err(e) => {
                modules::logger::log_error(&format!("加载账号 {} 失败: {}", summary.id, e));
            }
        }
    }
    
    Ok(accounts)
}

/// 添加账号
pub fn add_account(email: String, name: Option<String>, token: TokenData) -> Result<Account, String> {
    let _lock = ACCOUNT_INDEX_LOCK.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    let mut index = load_account_index()?;
    
    if index.accounts.iter().any(|s| s.email == email) {
        return Err(format!("账号已存在: {}", email));
    }
    
    let account_id = Uuid::new_v4().to_string();
    let mut account = Account::new(account_id.clone(), email.clone(), token);
    account.name = name.clone();

    let fingerprint = crate::modules::fingerprint::generate_fingerprint(email.clone())?;
    account.fingerprint_id = Some(fingerprint.id.clone());
    
    save_account(&account)?;
    
    index.accounts.push(AccountSummary {
        id: account_id.clone(),
        email: email.clone(),
        name: name.clone(),
        created_at: account.created_at,
        last_used: account.last_used,
    });
    
    if index.current_account_id.is_none() {
        index.current_account_id = Some(account_id);
    }
    
    save_account_index(&index)?;
    
    Ok(account)
}

/// 添加或更新账号
pub fn upsert_account(email: String, name: Option<String>, token: TokenData) -> Result<Account, String> {
    let _lock = ACCOUNT_INDEX_LOCK.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    let mut index = load_account_index()?;
    
    let existing_account_id = index.accounts.iter()
        .find(|s| s.email == email)
        .map(|s| s.id.clone());
    
    if let Some(account_id) = existing_account_id {
        match load_account(&account_id) {
            Ok(mut account) => {
                account.token = token;
                account.name = name.clone();
                if account.disabled {
                    account.disabled = false;
                    account.disabled_reason = None;
                    account.disabled_at = None;
                }
                account.update_last_used();
                save_account(&account)?;
                
                if let Some(idx_summary) = index.accounts.iter_mut().find(|s| s.id == account_id) {
                    idx_summary.name = name;
                    save_account_index(&index)?;
                }
                
                return Ok(account);
            }
            Err(e) => {
                modules::logger::log_warn(&format!("Account {} file missing ({}), recreating...", account_id, e));
                let mut account = Account::new(account_id.clone(), email.clone(), token);
                account.name = name.clone();
                let fingerprint = crate::modules::fingerprint::generate_fingerprint(email.clone())?;
                account.fingerprint_id = Some(fingerprint.id.clone());
                save_account(&account)?;
                
                if let Some(idx_summary) = index.accounts.iter_mut().find(|s| s.id == account_id) {
                    idx_summary.name = name;
                    save_account_index(&index)?;
                }
                
                return Ok(account);
            }
        }
    }
    
    drop(_lock);
    add_account(email, name, token)
}

/// 删除账号
pub fn delete_account(account_id: &str) -> Result<(), String> {
    let _lock = ACCOUNT_INDEX_LOCK.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    let mut index = load_account_index()?;
    
    let original_len = index.accounts.len();
    index.accounts.retain(|s| s.id != account_id);
    
    if index.accounts.len() == original_len {
        return Err(format!("找不到账号 ID: {}", account_id));
    }
    
    if index.current_account_id.as_deref() == Some(account_id) {
        index.current_account_id = index.accounts.first().map(|s| s.id.clone());
    }
    
    save_account_index(&index)?;
    
    let accounts_dir = get_accounts_dir()?;
    let account_path = accounts_dir.join(format!("{}.json", account_id));
    
    if account_path.exists() {
        fs::remove_file(&account_path)
            .map_err(|e| format!("删除账号文件失败: {}", e))?;
    }
    
    Ok(())
}

/// 批量删除账号
pub fn delete_accounts(account_ids: &[String]) -> Result<(), String> {
    let _lock = ACCOUNT_INDEX_LOCK.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    let mut index = load_account_index()?;
    
    let accounts_dir = get_accounts_dir()?;
    
    for account_id in account_ids {
        index.accounts.retain(|s| &s.id != account_id);
        
        if index.current_account_id.as_deref() == Some(account_id) {
            index.current_account_id = None;
        }
        
        let account_path = accounts_dir.join(format!("{}.json", account_id));
        if account_path.exists() {
            let _ = fs::remove_file(&account_path);
        }
    }
    
    if index.current_account_id.is_none() {
        index.current_account_id = index.accounts.first().map(|s| s.id.clone());
    }
    
    save_account_index(&index)
}

/// 重新排序账号列表
pub fn reorder_accounts(account_ids: &[String]) -> Result<(), String> {
    let _lock = ACCOUNT_INDEX_LOCK.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    let mut index = load_account_index()?;
    
    let id_to_summary: std::collections::HashMap<_, _> = index.accounts
        .iter()
        .map(|s| (s.id.clone(), s.clone()))
        .collect();
    
    let mut new_accounts = Vec::new();
    for id in account_ids {
        if let Some(summary) = id_to_summary.get(id) {
            new_accounts.push(summary.clone());
        }
    }
    
    for summary in &index.accounts {
        if !account_ids.contains(&summary.id) {
            new_accounts.push(summary.clone());
        }
    }
    
    index.accounts = new_accounts;
    
    save_account_index(&index)
}

/// 获取当前账号 ID
pub fn get_current_account_id() -> Result<Option<String>, String> {
    let index = load_account_index()?;
    Ok(index.current_account_id)
}

/// 获取当前激活账号
pub fn get_current_account() -> Result<Option<Account>, String> {
    if let Some(id) = get_current_account_id()? {
        let mut account = load_account(&id)?;
        let _ = modules::quota_cache::apply_cached_quota(&mut account, "authorized");
        Ok(Some(account))
    } else {
        Ok(None)
    }
}

/// 设置当前激活账号 ID
pub fn set_current_account_id(account_id: &str) -> Result<(), String> {
    let _lock = ACCOUNT_INDEX_LOCK.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    let mut index = load_account_index()?;
    index.current_account_id = Some(account_id.to_string());
    save_account_index(&index)?;
    
    // 同时写入 current_account.json 供扩展读取
    if let Ok(account) = load_account(account_id) {
        let _ = save_current_account_file(&account.email);
    }
    
    Ok(())
}

/// 保存当前账号信息到共享文件（供扩展启动时读取）
fn save_current_account_file(email: &str) -> Result<(), String> {
    use std::fs;
    use std::io::Write;
    
    let data_dir = get_data_dir()?;
    let file_path = data_dir.join("current_account.json");
    
    let content = serde_json::json!({
        "email": email,
        "updated_at": chrono::Utc::now().timestamp()
    });
    
    let json = serde_json::to_string_pretty(&content)
        .map_err(|e| format!("序列化失败: {}", e))?;
    
    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;
    
    modules::logger::log_info(&format!("已保存当前账号: {}", email));
    Ok(())
}

/// 更新账号配额
pub fn update_account_quota(account_id: &str, quota: QuotaData) -> Result<(), String> {
    let mut account = load_account(account_id)?;
    
    // 容错：如果新获取的 models 为空，但之前有数据，保留原来的 models
    if quota.models.is_empty() {
        if let Some(ref existing_quota) = account.quota {
            if !existing_quota.models.is_empty() {
                modules::logger::log_warn(&format!(
                    "⚠️ [{}] 新配额 models 为空，保留原有 {} 个模型数据",
                    account.email,
                    existing_quota.models.len()
                ));
                // 只更新非 models 字段（subscription_tier, is_forbidden 等）
                let mut merged_quota = existing_quota.clone();
                merged_quota.subscription_tier = quota.subscription_tier.clone();
                merged_quota.is_forbidden = quota.is_forbidden;
                merged_quota.last_updated = quota.last_updated;
                account.update_quota(merged_quota);
                save_account(&account)?;
                return Ok(());
            }
        }
    }
    
    account.update_quota(quota);
    save_account(&account)?;
    if let Some(ref quota) = account.quota {
        let _ = modules::quota_cache::write_quota_cache("authorized", &account.email, quota);
    }
    Ok(())
}

/// 设备指纹信息（兼容旧 API）
#[derive(Debug, Serialize)]
pub struct DeviceProfiles {
    pub current_storage: Option<DeviceProfile>,
    pub bound_profile: Option<DeviceProfile>,
    pub history: Vec<DeviceProfileVersion>,
    pub baseline: Option<DeviceProfile>,
}

pub fn get_device_profiles(account_id: &str) -> Result<DeviceProfiles, String> {
    let storage_path = crate::modules::device::get_storage_path()?;
    let current = crate::modules::device::read_profile(&storage_path).ok();
    let account = load_account(account_id)?;
    
    // 获取账号绑定的指纹
    let bound = account.fingerprint_id.as_ref()
        .and_then(|fp_id| crate::modules::fingerprint::get_fingerprint(fp_id).ok())
        .map(|fp| fp.profile);
    
    // 获取原始指纹
    let baseline = crate::modules::fingerprint::load_fingerprint_store()
        .ok()
        .and_then(|store| store.original_baseline)
        .map(|fp| fp.profile);
    
    Ok(DeviceProfiles {
        current_storage: current,
        bound_profile: bound,
        history: Vec::new(), // 历史功能已移除
        baseline,
    })
}

/// 绑定设备指纹（兼容旧 API，现在会创建新指纹并绑定）
#[allow(dead_code)]
pub fn bind_device_profile(account_id: &str, mode: &str) -> Result<DeviceProfile, String> {
    let name = format!("自动生成 {}", chrono::Utc::now().format("%Y-%m-%d %H:%M"));
    
    let fingerprint = match mode {
        "capture" => crate::modules::fingerprint::capture_fingerprint(name)?,
        "generate" => crate::modules::fingerprint::generate_fingerprint(name)?,
        _ => return Err("mode 只能是 capture 或 generate".to_string()),
    };
    
    // 绑定到账号
    let mut account = load_account(account_id)?;
    account.fingerprint_id = Some(fingerprint.id.clone());
    save_account(&account)?;
    
    Ok(fingerprint.profile)
}

/// 使用指定的 profile 绑定（创建新指纹并绑定）
pub fn bind_device_profile_with_profile(account_id: &str, profile: DeviceProfile) -> Result<DeviceProfile, String> {
    use crate::modules::fingerprint;
    
    let name = format!("自动生成 {}", chrono::Utc::now().format("%Y-%m-%d %H:%M"));
    
    // 创建新指纹
    let mut store = fingerprint::load_fingerprint_store()?;
    let fp = fingerprint::Fingerprint::new(name, profile.clone());
    store.fingerprints.push(fp.clone());
    fingerprint::save_fingerprint_store(&store)?;
    
    // 绑定到账号
    let mut account = load_account(account_id)?;
    account.fingerprint_id = Some(fp.id.clone());
    save_account(&account)?;
    
    // 应用到系统
    if let Ok(storage_path) = crate::modules::device::get_storage_path() {
        let _ = crate::modules::device::write_profile(&storage_path, &fp.profile);
    }
    
    Ok(fp.profile)
}

/// 列出指纹版本（兼容旧 API）
#[allow(dead_code)]
pub fn list_device_versions(account_id: &str) -> Result<DeviceProfiles, String> {
    get_device_profiles(account_id)
}

/// 恢复指纹版本（兼容旧 API）
#[allow(dead_code)]
pub fn restore_device_version(_account_id: &str, version_id: &str) -> Result<DeviceProfile, String> {
    // 直接应用指定的指纹
    let fingerprint = crate::modules::fingerprint::get_fingerprint(version_id)?;
    let _ = crate::modules::fingerprint::apply_fingerprint(version_id);
    Ok(fingerprint.profile)
}

/// 删除历史指纹（兼容旧 API - 已废弃）
#[allow(dead_code)]
pub fn delete_device_version(_account_id: &str, version_id: &str) -> Result<(), String> {
    crate::modules::fingerprint::delete_fingerprint(version_id)
}

#[derive(Serialize)]
pub struct RefreshStats {
    pub total: usize,
    pub success: usize,
    pub failed: usize,
    pub details: Vec<String>,
}

/// 批量刷新所有账号配额
pub async fn refresh_all_quotas_logic() -> Result<RefreshStats, String> {
    use futures::future::join_all;
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    const MAX_CONCURRENT: usize = 5;
    let start = std::time::Instant::now();

    modules::logger::log_info(&format!(
        "开始批量刷新所有账号配额 (并发模式, 最大并发: {})",
        MAX_CONCURRENT
    ));
    let accounts = list_accounts()?;

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT));

    let tasks: Vec<_> = accounts
        .into_iter()
        .filter(|account| {
            if account.disabled {
                modules::logger::log_info(&format!("  - Skipping {} (Disabled)", account.email));
                return false;
            }
            if let Some(ref q) = account.quota {
                if q.is_forbidden {
                    modules::logger::log_info(&format!("  - Skipping {} (Forbidden)", account.email));
                    return false;
                }
            }
            true
        })
        .map(|mut account| {
            let email = account.email.clone();
            let account_id = account.id.clone();
            let permit = semaphore.clone();
            async move {
                let _guard = permit.acquire().await.unwrap();
                match fetch_quota_with_retry(&mut account).await {
                    Ok(quota) => {
                        if let Err(e) = update_account_quota(&account_id, quota) {
                            let msg = format!("Account {}: Save quota failed - {}", email, e);
                            Err(msg)
                        } else {
                            Ok(())
                        }
                    }
                    Err(e) => {
                        let msg = format!("Account {}: Fetch quota failed - {}", email, e);
                        Err(msg)
                    }
                }
            }
        })
        .collect();

    let total = tasks.len();
    let results = join_all(tasks).await;

    let mut success = 0;
    let mut failed = 0;
    let mut details = Vec::new();

    for result in results {
        match result {
            Ok(()) => success += 1,
            Err(msg) => {
                failed += 1;
                details.push(msg);
            }
        }
    }

    let elapsed = start.elapsed();
    modules::logger::log_info(&format!(
        "批量刷新完成: {} 成功, {} 失败, 耗时: {}ms",
        success,
        failed,
        elapsed.as_millis()
    ));

    Ok(RefreshStats {
        total,
        success,
        failed,
        details,
    })
}

/// 带重试的配额查询
pub async fn fetch_quota_with_retry(account: &mut Account) -> crate::error::AppResult<QuotaData> {
    use crate::modules::oauth;
    use crate::error::AppError;
    
    let token = match oauth::ensure_fresh_token(&account.token).await {
        Ok(t) => t,
        Err(e) => {
            if e.contains("invalid_grant") {
                account.disabled = true;
                account.disabled_at = Some(chrono::Utc::now().timestamp());
                account.disabled_reason = Some(format!("invalid_grant: {}", e));
                let _ = save_account(account);
            }
            return Err(AppError::OAuth(e));
        }
    };
    
    if token.access_token != account.token.access_token {
        account.token = token.clone();
        let _ = upsert_account(account.email.clone(), account.name.clone(), token.clone());
    }

    let result = modules::quota::fetch_quota(&account.token.access_token, &account.email).await;
    result.map(|(q, _)| q)
}

/// 内部切换账号函数（供 WebSocket 调用）
/// 完整流程：Token刷新 + 关闭程序 + 注入 + 指纹同步 + 重启
pub async fn switch_account_internal(account_id: &str) -> Result<Account, String> {
    use std::fs;
    
    modules::logger::log_info(&format!("[Switch] 开始切换账号: {}", account_id));
    
    // 1. 加载并验证账号存在
    let mut account = load_account(account_id)?;
    modules::logger::log_info(&format!("[Switch] 正在切换到账号: {} (ID: {})", account.email, account.id));
    
    // 2. 确保 Token 有效（自动刷新过期的 Token）
    let fresh_token = modules::oauth::ensure_fresh_token(&account.token).await
        .map_err(|e| format!("Token 刷新失败: {}", e))?;
    
    // 如果 Token 更新了，保存回账号文件
    if fresh_token.access_token != account.token.access_token {
        modules::logger::log_info(&format!("[Switch] Token 已刷新: {}", account.email));
        account.token = fresh_token.clone();
        save_account(&account)?;
    }
    
    // 3. 关闭 Antigravity（等待最多 20 秒）
    if modules::process::is_antigravity_running() {
        modules::logger::log_info("[Switch] 检测到 Antigravity 正在运行，正在关闭...");
        modules::process::close_antigravity(20)?;
    }
    
    // 4. 写入设备指纹到 storage.json
    if let Ok(storage_path) = modules::device::get_storage_path() {
        if let Some(ref fp_id) = account.fingerprint_id {
            // 优先使用绑定的指纹
            if let Ok(fingerprint) = modules::fingerprint::get_fingerprint(fp_id) {
                modules::logger::log_info(&format!(
                    "[Switch] 写入设备指纹: machineId={}, serviceMachineId={}",
                    fingerprint.profile.machine_id,
                    fingerprint.profile.service_machine_id
                ));
                let _ = modules::device::write_profile(&storage_path, &fingerprint.profile);
                let _ = modules::db::write_service_machine_id(&fingerprint.profile.service_machine_id);
            }
        }
    }
    
    // 5. 备份数据库
    let db_path = modules::db::get_db_path()?;
    if db_path.exists() {
        let backup_path = db_path.with_extension("vscdb.backup");
        if let Err(e) = fs::copy(&db_path, &backup_path) {
            modules::logger::log_warn(&format!("[Switch] 备份数据库失败: {}", e));
        } else {
            modules::logger::log_info("[Switch] 数据库已备份");
        }
    }
    
    // 6. 注入 Token 到 Antigravity 数据库
    modules::logger::log_info("[Switch] 正在注入 Token 到数据库...");
    modules::db::inject_token(
        &account.token.access_token,
        &account.token.refresh_token,
        account.token.expiry_timestamp,
    ).map_err(|e| {
        modules::logger::log_error(&format!("[Switch] Token 注入失败: {}", e));
        e
    })?;
    
    // 7. 更新工具内部状态
    set_current_account_id(account_id)?;
    account.update_last_used();
    save_account(&account)?;
    
    // 8. 重启 Antigravity
    modules::logger::log_info("[Switch] 正在重启 Antigravity...");
    if let Err(e) = modules::process::start_antigravity() {
        modules::logger::log_warn(&format!("[Switch] Antigravity 启动失败: {}", e));
        // 不中断流程，允许用户手动启动
    }
    
    modules::logger::log_info(&format!("[Switch] 账号切换完成: {}", account.email));
    Ok(account)
}
