use crate::models::codex::{
    CodexAccount, CodexAccountIndex, CodexAccountSummary, CodexAuthFile, CodexAuthTokens,
    CodexJwtPayload, CodexTokens,
};
use crate::modules::logger;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use std::fs;
use std::path::PathBuf;

/// 获取 Codex 数据目录
pub fn get_codex_home() -> PathBuf {
    dirs::home_dir().expect("无法获取用户主目录").join(".codex")
}

/// 获取官方 auth.json 路径
pub fn get_auth_json_path() -> PathBuf {
    get_codex_home().join("auth.json")
}

/// 获取我们的多账号存储路径
fn get_accounts_storage_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| dirs::home_dir().expect("无法获取用户目录"))
        .join("com.antigravity.cockpit-tools");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("codex_accounts.json")
}

/// 获取账号详情存储目录
fn get_accounts_dir() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| dirs::home_dir().expect("无法获取用户目录"))
        .join("com.antigravity.cockpit-tools")
        .join("codex_accounts");
    fs::create_dir_all(&data_dir).ok();
    data_dir
}

/// 解析 JWT Token 的 payload
pub fn decode_jwt_payload(token: &str) -> Result<CodexJwtPayload, String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return Err("无效的 JWT Token 格式".to_string());
    }

    let payload_b64 = parts[1];
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    let payload: CodexJwtPayload =
        serde_json::from_slice(&payload_bytes).map_err(|e| format!("JSON 解析失败: {}", e))?;

    Ok(payload)
}

/// 从 id_token 提取用户信息
pub fn extract_user_info(
    id_token: &str,
) -> Result<(String, Option<String>, Option<String>, Option<String>), String> {
    let payload = decode_jwt_payload(id_token)?;

    let email = payload.email.ok_or("id_token 中缺少 email")?;
    let user_id = payload
        .auth_data
        .as_ref()
        .and_then(|d| d.chatgpt_user_id.clone());
    let plan_type = payload
        .auth_data
        .as_ref()
        .and_then(|d| d.chatgpt_plan_type.clone());
    let account_id = payload
        .auth_data
        .as_ref()
        .and_then(|d| d.account_id.clone());

    Ok((email, user_id, plan_type, account_id))
}

/// 读取账号索引
pub fn load_account_index() -> CodexAccountIndex {
    let path = get_accounts_storage_path();
    if !path.exists() {
        return CodexAccountIndex::new();
    }

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| CodexAccountIndex::new()),
        Err(_) => CodexAccountIndex::new(),
    }
}

/// 保存账号索引
pub fn save_account_index(index: &CodexAccountIndex) -> Result<(), String> {
    let path = get_accounts_storage_path();
    let content = serde_json::to_string_pretty(index).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/// 读取单个账号详情
pub fn load_account(account_id: &str) -> Option<CodexAccount> {
    let path = get_accounts_dir().join(format!("{}.json", account_id));
    if !path.exists() {
        return None;
    }

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).ok(),
        Err(_) => None,
    }
}

/// 保存单个账号详情
pub fn save_account(account: &CodexAccount) -> Result<(), String> {
    let path = get_accounts_dir().join(format!("{}.json", &account.id));
    let content =
        serde_json::to_string_pretty(account).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

/// 删除单个账号
pub fn delete_account_file(account_id: &str) -> Result<(), String> {
    let path = get_accounts_dir().join(format!("{}.json", account_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    Ok(())
}

/// 列出所有账号
pub fn list_accounts() -> Vec<CodexAccount> {
    let index = load_account_index();
    index
        .accounts
        .iter()
        .filter_map(|summary| load_account(&summary.id))
        .collect()
}

/// 添加或更新账号
pub fn upsert_account(tokens: CodexTokens) -> Result<CodexAccount, String> {
    let (email, user_id, plan_type, account_id) = extract_user_info(&tokens.id_token)?;

    // 使用 email 的 hash 作为 ID
    let id = format!("codex_{:x}", md5::compute(email.as_bytes()));

    let mut index = load_account_index();

    // 检查是否已存在
    let existing = index.accounts.iter().position(|a| a.email == email);

    let account = if let Some(pos) = existing {
        // 更新现有账号
        let existing_id = index.accounts[pos].id.clone();
        let mut acc = load_account(&existing_id)
            .unwrap_or_else(|| CodexAccount::new(existing_id, email.clone(), tokens.clone()));
        acc.tokens = tokens;
        acc.user_id = user_id;
        acc.plan_type = plan_type.clone();
        acc.account_id = account_id;
        acc.update_last_used();
        acc
    } else {
        // 创建新账号
        let mut acc = CodexAccount::new(id.clone(), email.clone(), tokens);
        acc.user_id = user_id;
        acc.plan_type = plan_type.clone();
        acc.account_id = account_id;

        index.accounts.push(CodexAccountSummary {
            id: id.clone(),
            email: email.clone(),
            plan_type: plan_type.clone(),
            created_at: acc.created_at,
            last_used: acc.last_used,
        });
        acc
    };

    // 保存账号详情
    save_account(&account)?;

    // 更新索引中的摘要信息
    if let Some(summary) = index.accounts.iter_mut().find(|a| a.email == email) {
        summary.plan_type = account.plan_type.clone();
        summary.last_used = account.last_used;
    }

    save_account_index(&index)?;

    logger::log_info(&format!("Codex 账号已保存: {}", email));

    Ok(account)
}

/// 删除账号
pub fn remove_account(account_id: &str) -> Result<(), String> {
    let mut index = load_account_index();

    // 从索引中移除
    index.accounts.retain(|a| a.id != account_id);

    // 如果删除的是当前账号，清除 current_account_id
    if index.current_account_id.as_deref() == Some(account_id) {
        index.current_account_id = None;
    }

    save_account_index(&index)?;
    delete_account_file(account_id)?;

    Ok(())
}

/// 批量删除账号
pub fn remove_accounts(account_ids: &[String]) -> Result<(), String> {
    for id in account_ids {
        remove_account(id)?;
    }
    Ok(())
}

/// 获取当前激活的账号（基于 auth.json）
pub fn get_current_account() -> Option<CodexAccount> {
    let auth_path = get_auth_json_path();
    if !auth_path.exists() {
        return None;
    }

    let content = fs::read_to_string(&auth_path).ok()?;
    let auth_file: CodexAuthFile = serde_json::from_str(&content).ok()?;

    // 从 id_token 提取 email
    let (email, _, _, _) = extract_user_info(&auth_file.tokens.id_token).ok()?;

    // 在我们的账号列表中查找
    let accounts = list_accounts();
    accounts.into_iter().find(|a| a.email == email)
}

/// 切换账号（写入 auth.json）
pub fn switch_account(account_id: &str) -> Result<CodexAccount, String> {
    let account = load_account(account_id).ok_or_else(|| format!("账号不存在: {}", account_id))?;

    // 构造 auth.json 内容
    let auth_file = CodexAuthFile {
        openai_api_key: Some(serde_json::Value::Null),
        tokens: CodexAuthTokens {
            id_token: account.tokens.id_token.clone(),
            access_token: account.tokens.access_token.clone(),
            refresh_token: account.tokens.refresh_token.clone(),
            account_id: account.account_id.clone(),
        },
        last_refresh: Some(serde_json::Value::String(
            chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.6fZ")
                .to_string(),
        )),
    };

    // 确保目录存在
    let auth_path = get_auth_json_path();
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent).ok();
    }

    // 写入文件
    let content =
        serde_json::to_string_pretty(&auth_file).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&auth_path, content).map_err(|e| format!("写入 auth.json 失败: {}", e))?;

    // 更新索引中的 current_account_id
    let mut index = load_account_index();
    index.current_account_id = Some(account_id.to_string());
    save_account_index(&index)?;

    // 更新账号的 last_used
    let mut updated_account = account.clone();
    updated_account.update_last_used();
    save_account(&updated_account)?;

    logger::log_info(&format!("已切换到 Codex 账号: {}", account.email));

    Ok(updated_account)
}

/// 从本地 auth.json 导入账号
pub fn import_from_local() -> Result<CodexAccount, String> {
    let auth_path = get_auth_json_path();
    if !auth_path.exists() {
        return Err("未找到 ~/.codex/auth.json 文件".to_string());
    }

    let content =
        fs::read_to_string(&auth_path).map_err(|e| format!("读取 auth.json 失败: {}", e))?;

    let auth_file: CodexAuthFile =
        serde_json::from_str(&content).map_err(|e| format!("解析 auth.json 失败: {}", e))?;

    let tokens = CodexTokens {
        id_token: auth_file.tokens.id_token,
        access_token: auth_file.tokens.access_token,
        refresh_token: auth_file.tokens.refresh_token,
    };

    upsert_account(tokens)
}

/// 从 JSON 字符串导入账号
pub fn import_from_json(json_content: &str) -> Result<Vec<CodexAccount>, String> {
    // 尝试解析为 auth.json 格式
    if let Ok(auth_file) = serde_json::from_str::<CodexAuthFile>(json_content) {
        let tokens = CodexTokens {
            id_token: auth_file.tokens.id_token,
            access_token: auth_file.tokens.access_token,
            refresh_token: auth_file.tokens.refresh_token,
        };
        let account = upsert_account(tokens)?;
        return Ok(vec![account]);
    }

    // 尝试解析为账号数组
    if let Ok(accounts) = serde_json::from_str::<Vec<CodexAccount>>(json_content) {
        let mut result = Vec::new();
        for acc in accounts {
            let imported = upsert_account(acc.tokens)?;
            result.push(imported);
        }
        return Ok(result);
    }

    Err("无法解析 JSON 内容".to_string())
}

/// 导出账号为 JSON
pub fn export_accounts(account_ids: &[String]) -> Result<String, String> {
    let accounts: Vec<CodexAccount> = account_ids
        .iter()
        .filter_map(|id| load_account(id))
        .collect();

    serde_json::to_string_pretty(&accounts).map_err(|e| format!("序列化失败: {}", e))
}

pub fn update_account_tags(account_id: &str, tags: Vec<String>) -> Result<CodexAccount, String> {
    let mut account =
        load_account(account_id).ok_or_else(|| format!("账号不存在: {}", account_id))?;

    account.tags = Some(tags);
    save_account(&account)?;

    Ok(account)
}
