use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::models::QuotaData;
use crate::modules;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

const QUOTA_API_URL: &str = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const CLOUD_CODE_BASE_URLS: [&str; 3] = [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
];
const USER_AGENT: &str = "antigravity";
const DEFAULT_ATTEMPTS: usize = 2;
const BACKOFF_BASE_MS: u64 = 500;
const BACKOFF_MAX_MS: u64 = 4000;
const ONBOARD_ATTEMPTS: usize = 5;
const ONBOARD_DELAY_MS: u64 = 2000;
const API_CACHE_DIR: &str = "cache/quota_api_v1";
const API_CACHE_VERSION: u8 = 1;
const API_CACHE_TTL_MS: i64 = 60_000;

fn truncate_log_text(text: &str, max_len: usize) -> String {
    if text.chars().count() <= max_len {
        return text.to_string();
    }
    let mut preview = text.chars().take(max_len).collect::<String>();
    preview.push_str("...");
    preview
}

fn header_value(headers: &reqwest::header::HeaderMap, name: reqwest::header::HeaderName) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("-")
        .to_string()
}

fn hash_email(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn api_cache_path(source: &str, email: &str) -> Result<PathBuf, String> {
    let data_dir = modules::account::get_data_dir()?;
    let dir = data_dir.join(API_CACHE_DIR).join(source);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create quota api cache dir: {}", e))?;
    }
    Ok(dir.join(format!("{}.json", hash_email(email))))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaApiCacheRecord {
    version: u8,
    source: String,
    custom_source: String,
    email: String,
    project_id: Option<String>,
    updated_at: i64,
    payload: serde_json::Value,
}

fn read_api_cache(source: &str, email: &str) -> Option<QuotaApiCacheRecord> {
    let path = api_cache_path(source, email).ok()?;
    let content = fs::read_to_string(path).ok()?;
    let record = serde_json::from_str::<QuotaApiCacheRecord>(&content).ok()?;
    if record.version != API_CACHE_VERSION {
        return None;
    }
    if record.source != source {
        return None;
    }
    Some(record)
}

fn is_api_cache_valid(record: &QuotaApiCacheRecord) -> bool {
    let now_ms = Utc::now().timestamp_millis();
    now_ms - record.updated_at < API_CACHE_TTL_MS
}

fn api_cache_age_secs(record: &QuotaApiCacheRecord) -> i64 {
    let now_ms = Utc::now().timestamp_millis();
    std::cmp::max(0, (now_ms - record.updated_at) / 1000)
}

fn write_api_cache(source: &str, custom_source: &str, email: &str, project_id: Option<String>, payload: serde_json::Value) {
    if let Ok(path) = api_cache_path(source, email) {
        let record = QuotaApiCacheRecord {
            version: API_CACHE_VERSION,
            source: source.to_string(),
            custom_source: custom_source.to_string(),
            email: email.to_string(),
            project_id,
            updated_at: Utc::now().timestamp_millis(),
            payload,
        };
        if let Ok(content) = serde_json::to_string_pretty(&record) {
            let _ = fs::write(path, content);
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct QuotaResponse {
    models: std::collections::HashMap<String, ModelInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelInfo {
    #[serde(rename = "quotaInfo")]
    quota_info: Option<QuotaInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct QuotaInfo {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LoadProjectResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project: Option<serde_json::Value>,
    #[serde(rename = "currentTier")]
    current_tier: Option<Tier>,
    #[serde(rename = "paidTier")]
    paid_tier: Option<Tier>,
    #[serde(rename = "allowedTiers")]
    allowed_tiers: Option<Vec<AllowedTier>>,
}

#[derive(Debug, Deserialize)]
struct AllowedTier {
    id: Option<String>,
    #[serde(rename = "isDefault")]
    is_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct Tier {
    id: Option<String>,
    #[allow(dead_code)]
    #[serde(rename = "quotaTier")]
    quota_tier: Option<String>,
    #[allow(dead_code)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OnboardUserResponse {
    done: Option<bool>,
    response: Option<OnboardResponse>,
}

#[derive(Debug, Deserialize)]
struct OnboardResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project: Option<serde_json::Value>,
}

fn create_client() -> reqwest::Client {
    crate::utils::http::create_client(15)
}

fn build_metadata_payload() -> serde_json::Value {
    json!({
        "metadata": {
            "ideType": "ANTIGRAVITY",
            "platform": "PLATFORM_UNSPECIFIED",
            "pluginType": "GEMINI"
        }
    })
}

fn extract_project_id(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        if !text.is_empty() {
            return Some(text.to_string());
        }
    }
    if let Some(obj) = value.as_object() {
        if let Some(id_value) = obj.get("id") {
            if let Some(id) = id_value.as_str() {
                if !id.is_empty() {
                    return Some(id.to_string());
                }
            }
        }
    }
    None
}

fn pick_onboard_tier(allowed: &[AllowedTier]) -> Option<String> {
    if let Some(default) = allowed.iter().find(|tier| tier.is_default.unwrap_or(false)) {
        if let Some(id) = default.id.clone() {
            return Some(id);
        }
    }
    if let Some(first) = allowed.iter().find(|tier| tier.id.is_some()) {
        return first.id.clone();
    }
    if !allowed.is_empty() {
        return Some("LEGACY".to_string());
    }
    None
}

fn get_backoff_delay_ms(attempt: usize) -> u64 {
    if attempt < 2 {
        return 0;
    }
    let raw = BACKOFF_BASE_MS.saturating_mul(2u64.saturating_pow((attempt - 2) as u32));
    let jitter = rand::random::<u64>() % 100;
    std::cmp::min(raw + jitter, BACKOFF_MAX_MS)
}

async fn try_onboard_user(
    client: &reqwest::Client,
    base_url: &str,
    access_token: &str,
    tier_id: &str,
) -> Result<Option<String>, String> {
    let payload = json!({
        "tierId": tier_id,
        "metadata": {
            "ideType": "ANTIGRAVITY",
            "platform": "PLATFORM_UNSPECIFIED",
            "pluginType": "GEMINI"
        }
    });

    for _ in 0..ONBOARD_ATTEMPTS {
        let response = client
            .post(format!("{}/v1internal:onboardUser", base_url))
            .bearer_auth(access_token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .header(reqwest::header::ACCEPT_ENCODING, "gzip")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("onboardUser 网络错误: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("onboardUser 失败: {} - {}", status, text));
        }

        let data = response
            .json::<OnboardUserResponse>()
            .await
            .map_err(|e| format!("onboardUser 解析失败: {}", e))?;

        if data.done.unwrap_or(false) {
            if let Some(project) = data.response.and_then(|resp| resp.project) {
                return Ok(extract_project_id(&project));
            }
            return Ok(None);
        }

        tokio::time::sleep(std::time::Duration::from_millis(ONBOARD_DELAY_MS)).await;
    }

    Ok(None)
}

/// 获取项目 ID 和订阅类型
pub async fn fetch_project_id(access_token: &str, email: &str) -> (Option<String>, Option<String>) {
    let client = create_client();
    let mut subscription_tier: Option<String> = None;
    let mut allowed_tiers: Vec<AllowedTier> = Vec::new();
    let mut last_error: Option<String> = None;
    let meta = build_metadata_payload();

    for base in CLOUD_CODE_BASE_URLS {
        for attempt in 1..=DEFAULT_ATTEMPTS {
            let response = client
                .post(format!("{}/v1internal:loadCodeAssist", base))
                .bearer_auth(access_token)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::USER_AGENT, USER_AGENT)
                .header(reqwest::header::ACCEPT_ENCODING, "gzip")
                .json(&meta)
                .send()
                .await;

            match response {
                Ok(res) => {
                    let status = res.status();
                    let headers = res.headers().clone();
                    if status.is_success() {
                        let text_result = res.text().await;
                        match text_result {
                            Ok(text) => match serde_json::from_str::<LoadProjectResponse>(&text) {
                                Ok(data) => {
                                subscription_tier = data.paid_tier
                                    .and_then(|t| t.id)
                                    .or_else(|| data.current_tier.and_then(|t| t.id));

                                if let Some(ref tier) = subscription_tier {
                                    crate::modules::logger::log_info(&format!(
                                        "📊 [{}] 订阅识别成功: {}", email, tier
                                    ));
                                }

                                if let Some(project) = data.project {
                                    if let Some(project_id) = extract_project_id(&project) {
                                        return (Some(project_id), subscription_tier);
                                    }
                                }

                                if let Some(tiers) = data.allowed_tiers {
                                    allowed_tiers = tiers;
                                }

                                let onboard_tier = pick_onboard_tier(&allowed_tiers)
                                    .or_else(|| subscription_tier.clone());
                                if let Some(tier_id) = onboard_tier {
                                    match try_onboard_user(&client, base, access_token, &tier_id).await {
                                        Ok(project_id) => {
                                            if let Some(project_id) = project_id {
                                                return (Some(project_id), subscription_tier);
                                            }
                                        }
                                        Err(err) => {
                                            crate::modules::logger::log_warn(&format!(
                                                "⚠️ [{}] onboardUser 失败: {}",
                                                email, err
                                            ));
                                        }
                                    }
                                }

                                return (None, subscription_tier);
                                }
                                Err(err) => {
                                    last_error = Some(format!("loadCodeAssist 解析失败: {}", err));
                                    let header_info = format!(
                                        "status={}, content-type={}, content-encoding={}, content-length={}",
                                        status,
                                        header_value(&headers, reqwest::header::CONTENT_TYPE),
                                        header_value(&headers, reqwest::header::CONTENT_ENCODING),
                                        header_value(&headers, reqwest::header::CONTENT_LENGTH)
                                    );
                                    crate::modules::logger::log_error(&format!(
                                        "❌ [{}] loadCodeAssist 解析失败: {}, {}",
                                        email, err, header_info
                                    ));
                                    crate::modules::logger::log_error(&format!(
                                        "❌ [{}] loadCodeAssist 原始响应: {}",
                                        email,
                                        truncate_log_text(&text, 2000)
                                    ));
                                }
                            },
                            Err(err) => {
                                last_error = Some(format!("loadCodeAssist 读取失败: {}", err));
                                let header_info = format!(
                                    "status={}, content-type={}, content-encoding={}, content-length={}",
                                    status,
                                    header_value(&headers, reqwest::header::CONTENT_TYPE),
                                    header_value(&headers, reqwest::header::CONTENT_ENCODING),
                                    header_value(&headers, reqwest::header::CONTENT_LENGTH)
                                );
                                crate::modules::logger::log_error(&format!(
                                    "❌ [{}] loadCodeAssist 响应读取失败: {}, {}",
                                    email, err, header_info
                                ));
                            }
                        }
                    } else if status == reqwest::StatusCode::UNAUTHORIZED {
                        return (None, subscription_tier);
                    } else if status == reqwest::StatusCode::FORBIDDEN {
                        return (None, subscription_tier);
                    } else {
                        let text = res.text().await.unwrap_or_default();
                        let retryable = status == reqwest::StatusCode::TOO_MANY_REQUESTS
                            || status.as_u16() >= 500;
                        last_error = Some(format!("loadCodeAssist 失败: {} - {}", status, text));
                        if retryable && attempt < DEFAULT_ATTEMPTS {
                            let delay = get_backoff_delay_ms(attempt + 1);
                            if delay > 0 {
                                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                            }
                            continue;
                        }
                    }
                }
                Err(e) => {
                    last_error = Some(format!("loadCodeAssist 网络错误: {}", e));
                    if attempt < DEFAULT_ATTEMPTS {
                        let delay = get_backoff_delay_ms(attempt + 1);
                        if delay > 0 {
                            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                        }
                        continue;
                    }
                }
            }
        }
    }

    if let Some(err) = last_error {
        crate::modules::logger::log_error(&format!("❌ [{}] loadCodeAssist 失败: {}", email, err));
    }

    (None, subscription_tier)
}

/// 查询账号配额
pub async fn fetch_quota(access_token: &str, email: &str) -> crate::error::AppResult<(QuotaData, Option<String>)> {
    use crate::error::AppError;
    
    let (project_id, subscription_tier) = fetch_project_id(access_token, email).await;

    if let Some(record) = read_api_cache("authorized", email) {
        if is_api_cache_valid(&record) {
            crate::modules::logger::log_info(&format!(
                "[QuotaApiCache] Using api cache for {} (age: {}s)",
                email,
                api_cache_age_secs(&record),
            ));
            if let Ok(quota_response) = serde_json::from_value::<QuotaResponse>(record.payload.clone()) {
                let mut quota_data = QuotaData::new();
                for (name, info) in quota_response.models {
                    if let Some(quota_info) = info.quota_info {
                        let percentage = quota_info.remaining_fraction
                            .map(|f| (f * 100.0) as i32)
                            .unwrap_or(0);
                        let reset_time = quota_info.reset_time.unwrap_or_default();
                        if name.contains("gemini") || name.contains("claude") {
                            quota_data.add_model(name, percentage, reset_time);
                        }
                    }
                }
                quota_data.subscription_tier = subscription_tier.clone();
                return Ok((quota_data, project_id.clone()));
            }
        } else {
            crate::modules::logger::log_info(&format!(
                "[QuotaApiCache] Cache expired for {} (age: {}s), fetching from network",
                email,
                api_cache_age_secs(&record),
            ));
        }
    }
    
    let client = create_client();
    let payload = project_id
        .as_ref()
        .map(|id| json!({ "project": id }))
        .unwrap_or_else(|| json!({}));
    
    let max_retries = 3;

    for attempt in 1..=max_retries {
        match client
            .post(QUOTA_API_URL)
            .bearer_auth(access_token)
            .header("User-Agent", USER_AGENT)
            .header(reqwest::header::ACCEPT_ENCODING, "gzip")
            .json(&json!(payload))
            .send()
            .await
        {
            Ok(response) => {
                if let Err(_) = response.error_for_status_ref() {
                    let status = response.status();
                    
                    if status == reqwest::StatusCode::FORBIDDEN {
                        crate::modules::logger::log_warn(&format!(
                            "账号无权限 (403 Forbidden), 标记为 forbidden 状态: {}", email
                        ));
                        let mut q = QuotaData::new();
                        q.is_forbidden = true;
                        q.subscription_tier = subscription_tier.clone();
                        return Ok((q, project_id.clone()));
                    }
                    
                    if attempt < max_retries {
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        continue;
                    } else {
                        let text = response.text().await.unwrap_or_default();
                        return Err(AppError::Unknown(format!("API 错误: {} - {}", status, text)));
                    }
                }

                let body = response
                    .text()
                    .await
                    .map_err(|e| AppError::Network(e))?;
                let payload_value: serde_json::Value = serde_json::from_str(&body)
                    .map_err(|e| AppError::Unknown(format!("API 响应解析失败: {}", e)))?;
                write_api_cache("authorized", "desktop", email, project_id.clone(), payload_value.clone());
                let quota_response: QuotaResponse = serde_json::from_value(payload_value)
                    .map_err(|e| AppError::Unknown(format!("API 响应解析失败: {}", e)))?;
                
                let mut quota_data = QuotaData::new();

                for (name, info) in quota_response.models {
                    if let Some(quota_info) = info.quota_info {
                        let percentage = quota_info.remaining_fraction
                            .map(|f| (f * 100.0) as i32)
                            .unwrap_or(0);
                        
                        let reset_time = quota_info.reset_time.unwrap_or_default();
                        
                        if name.contains("gemini") || name.contains("claude") {
                            quota_data.add_model(name, percentage, reset_time);
                        }
                    }
                }
                
                quota_data.subscription_tier = subscription_tier.clone();
                
                return Ok((quota_data, project_id.clone()));
            },
            Err(e) => {
                if attempt < max_retries {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                } else {
                    return Err(AppError::Network(e));
                }
            }
        }
    }
    
    Err(AppError::Unknown("配额查询失败".to_string()))
}
