use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};

use crate::models::{Account, QuotaData};
use crate::modules;

const CACHE_DIR: &str = "cache/quota_api_v1";
const CACHE_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuotaApiCacheRecord {
    version: u8,
    source: String,
    custom_source: Option<String>,
    email: String,
    project_id: Option<String>,
    updated_at: i64,
    payload: JsonValue,
}

#[derive(Debug, Deserialize)]
struct QuotaResponse {
    models: std::collections::HashMap<String, ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    #[serde(rename = "quotaInfo")]
    quota_info: Option<QuotaInfo>,
}

#[derive(Debug, Deserialize)]
struct QuotaInfo {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
}

fn hash_email(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn cache_dir(source: &str) -> Result<PathBuf, String> {
    let data_dir = modules::account::get_data_dir()?;
    let dir = data_dir.join(CACHE_DIR).join(source);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create quota cache dir: {}", e))?;
    }
    Ok(dir)
}

fn cache_path(source: &str, email: &str) -> Result<PathBuf, String> {
    let dir = cache_dir(source)?;
    Ok(dir.join(format!("{}.json", hash_email(email))))
}

pub(crate) fn read_quota_cache(source: &str, email: &str) -> Option<QuotaApiCacheRecord> {
    let path = cache_path(source, email).ok()?;
    let content = fs::read_to_string(path).ok()?;
    let record = serde_json::from_str::<QuotaApiCacheRecord>(&content).ok()?;
    if record.version != CACHE_VERSION {
        return None;
    }
    if record.source != source {
        return None;
    }
    Some(record)
}

pub fn write_quota_cache(source: &str, email: &str, quota: &QuotaData) -> Result<(), String> {
    let _ = source;
    let _ = email;
    let _ = quota;
    Ok(())
}

pub fn apply_cached_quota(account: &mut Account, source: &str) -> Result<bool, String> {
    let record = match read_quota_cache(source, &account.email) {
        Some(record) => record,
        None => return Ok(false),
    };

    let cache_updated = record.updated_at / 1000;
    let current_updated = account
        .quota
        .as_ref()
        .map(|quota| quota.last_updated)
        .unwrap_or(0);

    if current_updated >= cache_updated && account.quota.is_some() {
        return Ok(false);
    }

    let mut quota = QuotaData::new();
    quota.last_updated = cache_updated;
    quota.subscription_tier = account.quota.as_ref().and_then(|q| q.subscription_tier.clone());
    quota.is_forbidden = account.quota.as_ref().map(|q| q.is_forbidden).unwrap_or(false);

    let parsed = serde_json::from_value::<QuotaResponse>(record.payload.clone())
        .map_err(|e| format!("Failed to parse api cache payload: {}", e))?;
    for (name, info) in parsed.models {
        if let Some(quota_info) = info.quota_info {
            let percentage = quota_info.remaining_fraction
                .map(|f| (f * 100.0) as i32)
                .unwrap_or(0);
            let reset_time = quota_info.reset_time.unwrap_or_default();
            if name.contains("gemini") || name.contains("claude") {
                quota.add_model(name, percentage, reset_time);
            }
        }
    }

    // 容错：如果缓存的 models 为空，但账号已有配额数据，保留原有 models
    if quota.models.is_empty() {
        if let Some(ref existing_quota) = account.quota {
            if !existing_quota.models.is_empty() {
                // 只更新非 models 字段
                let mut merged_quota = existing_quota.clone();
                merged_quota.subscription_tier = quota.subscription_tier.clone();
                merged_quota.is_forbidden = quota.is_forbidden;
                // 不更新 last_updated，保留原有的时间戳
                account.update_quota(merged_quota);
                return Ok(true);
            }
        }
    }

    account.update_quota(quota);
    Ok(true)
}
