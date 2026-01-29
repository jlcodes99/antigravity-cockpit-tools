import { invoke } from '@tauri-apps/api/core';
import { Account, QuotaData, DeviceProfile, DeviceProfiles, RefreshStats, Fingerprint, FingerprintWithStats } from '../types/account';

export async function listAccounts(): Promise<Account[]> {
    return await invoke('list_accounts');
}

export async function addAccountWithToken(refreshToken: string): Promise<Account> {
    return await invoke('add_account', { refreshToken });
}

export async function addAccount(_email: string, refreshToken: string): Promise<Account> {
    return await addAccountWithToken(refreshToken);
}

export async function deleteAccount(accountId: string): Promise<void> {
    return await invoke('delete_account', { accountId });
}

export async function deleteAccounts(accountIds: string[]): Promise<void> {
    return await invoke('delete_accounts', { accountIds });
}

export async function reorderAccounts(accountIds: string[]): Promise<void> {
    return await invoke('reorder_accounts', { accountIds });
}

export async function getCurrentAccount(): Promise<Account | null> {
    return await invoke('get_current_account');
}

export async function setCurrentAccount(accountId: string): Promise<void> {
    return await invoke('set_current_account', { accountId });
}

export async function fetchAccountQuota(accountId: string): Promise<QuotaData> {
    return await invoke('fetch_account_quota', { accountId });
}

export async function refreshAllQuotas(): Promise<RefreshStats> {
    return await invoke('refresh_all_quotas');
}

export async function startOAuthLogin(): Promise<Account> {
    return await invoke('start_oauth_login');
}

export async function prepareOAuthUrl(): Promise<string> {
    return await invoke('prepare_oauth_url');
}

export async function completeOAuthLogin(): Promise<Account> {
    return await invoke('complete_oauth_login');
}

export async function cancelOAuthLogin(): Promise<void> {
    return await invoke('cancel_oauth_login');
}

export async function getDeviceProfiles(accountId: string): Promise<DeviceProfiles> {
    return await invoke('get_device_profiles', { accountId });
}

export async function bindDeviceProfile(accountId: string, mode: 'capture' | 'generate'): Promise<DeviceProfile> {
    return await invoke('bind_device_profile', { accountId, mode });
}

export async function bindDeviceProfileWithProfile(accountId: string, profile: DeviceProfile): Promise<DeviceProfile> {
    return await invoke('bind_device_profile_with_profile', { accountId, profile });
}

export async function listDeviceVersions(accountId: string): Promise<DeviceProfiles> {
    return await invoke('list_device_versions', { accountId });
}

export async function restoreDeviceVersion(accountId: string, versionId: string): Promise<DeviceProfile> {
    return await invoke('restore_device_version', { accountId, versionId });
}

export async function deleteDeviceVersion(accountId: string, versionId: string): Promise<void> {
    return await invoke('delete_device_version', { accountId, versionId });
}

export async function restoreOriginalDevice(): Promise<string> {
    return await invoke('restore_original_device');
}

export async function openDeviceFolder(): Promise<void> {
    return await invoke('open_device_folder');
}

export async function openDataFolder(): Promise<void> {
    return await invoke('open_data_folder');
}

export async function switchAccount(accountId: string): Promise<Account> {
    return await invoke('switch_account', { accountId });
}

export async function updateAccountTags(accountId: string, tags: string[]): Promise<Account> {
    return await invoke('update_account_tags', { accountId, tags });
}

export async function syncFromExtension(): Promise<number> {
    return await invoke('sync_from_extension');
}

export async function importFromOldTools(): Promise<Account[]> {
    return await invoke('import_from_old_tools');
}

export async function importFingerprintsFromOldTools(): Promise<number> {
    return await invoke('import_fingerprints_from_old_tools');
}

export async function importFingerprintsFromJson(jsonContent: string): Promise<number> {
    return await invoke('import_fingerprints_from_json', { jsonContent });
}

export async function importFromLocal(): Promise<Account> {
    return await invoke('import_from_local');
}

export async function importFromJson(jsonContent: string): Promise<Account[]> {
    return await invoke('import_from_json', { jsonContent });
}

export async function exportAccounts(accountIds: string[]): Promise<string> {
    return await invoke('export_accounts', { accountIds });
}

export async function previewGenerateProfile(): Promise<DeviceProfile> {
    return await invoke('preview_generate_profile');
}

export async function previewCurrentProfile(): Promise<DeviceProfile> {
    return await invoke('preview_current_profile');
}

// ==================== 指纹管理 API ====================

export async function listFingerprints(): Promise<FingerprintWithStats[]> {
    return await invoke('list_fingerprints');
}

export async function getFingerprint(fingerprintId: string): Promise<Fingerprint> {
    return await invoke('get_fingerprint', { fingerprintId });
}

export async function generateNewFingerprint(name: string): Promise<Fingerprint> {
    return await invoke('generate_new_fingerprint', { name });
}

export async function captureCurrentFingerprint(name: string): Promise<Fingerprint> {
    return await invoke('capture_current_fingerprint', { name });
}

export async function createFingerprintWithProfile(name: string, profile: DeviceProfile): Promise<Fingerprint> {
    return await invoke('create_fingerprint_with_profile', { name, profile });
}

export async function applyFingerprint(fingerprintId: string): Promise<string> {
    return await invoke('apply_fingerprint', { fingerprintId });
}

export async function deleteFingerprint(fingerprintId: string): Promise<void> {
    return await invoke('delete_fingerprint', { fingerprintId });
}

export async function renameFingerprint(fingerprintId: string, name: string): Promise<void> {
    return await invoke('rename_fingerprint', { fingerprintId, name });
}

export async function getCurrentFingerprintId(): Promise<string | null> {
    return await invoke('get_current_fingerprint_id');
}

export async function bindAccountFingerprint(accountId: string, fingerprintId: string): Promise<void> {
    return await invoke('bind_account_fingerprint', { accountId, fingerprintId });
}

export async function getBoundAccounts(fingerprintId: string): Promise<Account[]> {
    return await invoke('get_bound_accounts', { fingerprintId });
}

export async function syncCurrentFromClient(): Promise<string | null> {
    return await invoke('sync_current_from_client');
}
