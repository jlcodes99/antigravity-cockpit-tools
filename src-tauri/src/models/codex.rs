use serde::{Deserialize, Serialize};

/// Codex 账号数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAccount {
    pub id: String,
    pub email: String,
    pub user_id: Option<String>,
    pub plan_type: Option<String>,
    pub account_id: Option<String>,
    pub tokens: CodexTokens,
    pub quota: Option<CodexQuota>,
    pub tags: Option<Vec<String>>,
    pub created_at: i64,
    pub last_used: i64,
}

/// Codex Token 数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexTokens {
    pub id_token: String,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
}

/// Codex 配额数据（5小时配额 + 周配额）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexQuota {
    /// 5小时配额百分比 (0-100)
    pub hourly_percentage: i32,
    /// 5小时配额重置时间 (Unix timestamp)
    pub hourly_reset_time: Option<i64>,
    /// 周配额百分比 (0-100)
    pub weekly_percentage: i32,
    /// 周配额重置时间 (Unix timestamp)
    pub weekly_reset_time: Option<i64>,
    /// 原始响应数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_data: Option<serde_json::Value>,
}

/// ~/.codex/auth.json 文件格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthFile {
    #[serde(rename = "OPENAI_API_KEY")]
    pub openai_api_key: Option<serde_json::Value>, // 可以是 null 或字符串
    pub tokens: CodexAuthTokens,
    #[serde(default)]
    pub last_refresh: Option<serde_json::Value>, // 可以是字符串或数字
}

/// auth.json 中的 tokens 字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthTokens {
    pub id_token: String,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
}

/// Codex 账号索引（存储多账号）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAccountIndex {
    pub version: String,
    pub accounts: Vec<CodexAccountSummary>,
    pub current_account_id: Option<String>,
}

/// 账号摘要信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAccountSummary {
    pub id: String,
    pub email: String,
    pub plan_type: Option<String>,
    pub created_at: i64,
    pub last_used: i64,
}

impl CodexAccountIndex {
    pub fn new() -> Self {
        Self {
            version: "1.0".to_string(),
            accounts: Vec::new(),
            current_account_id: None,
        }
    }
}

impl Default for CodexAccountIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// JWT Payload 中的用户信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexJwtPayload {
    pub aud: serde_json::Value, // 可能是 string 或 array
    pub iss: Option<String>,
    pub email: Option<String>,
    pub email_verified: Option<bool>,
    pub exp: Option<i64>,
    pub iat: Option<i64>,
    pub sub: Option<String>,
    #[serde(rename = "https://api.openai.com/auth")]
    pub auth_data: Option<CodexAuthData>,
}

/// JWT 中的 auth 数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthData {
    pub chatgpt_user_id: Option<String>,
    pub chatgpt_plan_type: Option<String>,
    pub account_id: Option<String>,
    pub organization_id: Option<String>,
}

impl CodexAccount {
    pub fn new(id: String, email: String, tokens: CodexTokens) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id,
            email,
            user_id: None,
            plan_type: None,
            account_id: None,
            tokens,
            quota: None,
            tags: None,
            created_at: now,
            last_used: now,
        }
    }

    pub fn update_last_used(&mut self) {
        self.last_used = chrono::Utc::now().timestamp();
    }
}
