import { create } from 'zustand';
import { Account, RefreshStats } from '../types/account';
import * as accountService from '../services/accountService';

// 防抖状态（在 store 外部维护，避免触发 re-render）
let fetchAccountsPromise: Promise<void> | null = null;
let fetchAccountsLastTime = 0;
let fetchCurrentPromise: Promise<void> | null = null;
let fetchCurrentLastTime = 0;
const DEBOUNCE_MS = 500;

interface AccountState {
    accounts: Account[];
    currentAccount: Account | null;
    loading: boolean;
    error: string | null;
    fetchAccounts: () => Promise<void>;
    fetchCurrentAccount: () => Promise<void>;
    addAccount: (email: string, refreshToken: string) => Promise<Account>;
    deleteAccount: (accountId: string) => Promise<void>;
    deleteAccounts: (accountIds: string[]) => Promise<void>;
    setCurrentAccount: (accountId: string) => Promise<void>;
    refreshQuota: (accountId: string) => Promise<void>;
    refreshAllQuotas: () => Promise<RefreshStats>;
    startOAuthLogin: () => Promise<Account>;
    reorderAccounts: (accountIds: string[]) => Promise<void>;
    switchAccount: (accountId: string) => Promise<Account>;
    syncCurrentFromClient: () => Promise<void>;
    updateAccountTags: (accountId: string, tags: string[]) => Promise<Account>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
    accounts: [],
    currentAccount: null,
    loading: false,
    error: null,

    fetchAccounts: async () => {
        const now = Date.now();
        
        // 如果正在请求中，且距离上次请求不足 DEBOUNCE_MS，复用现有 Promise
        if (fetchAccountsPromise && now - fetchAccountsLastTime < DEBOUNCE_MS) {
            return fetchAccountsPromise;
        }
        
        fetchAccountsLastTime = now;
        
        fetchAccountsPromise = (async () => {
            set({ loading: true, error: null });
            try {
                const accounts = await accountService.listAccounts();
                set({ accounts, loading: false });
            } catch (e) {
                set({ error: String(e), loading: false });
            } finally {
                // 请求完成后延迟清除 Promise，允许短时间内的后续调用也复用结果
                setTimeout(() => {
                    fetchAccountsPromise = null;
                }, 100);
            }
        })();
        
        return fetchAccountsPromise;
    },

    fetchCurrentAccount: async () => {
        const now = Date.now();
        
        // 防抖：复用正在进行的请求
        if (fetchCurrentPromise && now - fetchCurrentLastTime < DEBOUNCE_MS) {
            return fetchCurrentPromise;
        }
        
        fetchCurrentLastTime = now;
        
        fetchCurrentPromise = (async () => {
            try {
                const account = await accountService.getCurrentAccount();
                set({ currentAccount: account });
            } catch (e) {
                console.error('Failed to fetch current account:', e);
            } finally {
                setTimeout(() => {
                    fetchCurrentPromise = null;
                }, 100);
            }
        })();
        
        return fetchCurrentPromise;
    },

    addAccount: async (email: string, refreshToken: string) => {
        const account = await accountService.addAccount(email, refreshToken);
        await get().fetchAccounts();
        return account;
    },

    deleteAccount: async (accountId: string) => {
        await accountService.deleteAccount(accountId);
        await get().fetchAccounts();
    },

    deleteAccounts: async (accountIds: string[]) => {
        await accountService.deleteAccounts(accountIds);
        await get().fetchAccounts();
    },

    setCurrentAccount: async (accountId: string) => {
        await accountService.setCurrentAccount(accountId);
        await get().fetchCurrentAccount();
    },

    refreshQuota: async (accountId: string) => {
        await accountService.fetchAccountQuota(accountId);
        await get().fetchAccounts();
    },

    refreshAllQuotas: async () => {
        const stats = await accountService.refreshAllQuotas();
        await get().fetchAccounts();
        return stats;
    },

    startOAuthLogin: async () => {
        const account = await accountService.startOAuthLogin();
        await get().fetchAccounts();
        return account;
    },

    reorderAccounts: async (accountIds: string[]) => {
        await accountService.reorderAccounts(accountIds);
        await get().fetchAccounts();
    },

    switchAccount: async (accountId: string) => {
        const account = await accountService.switchAccount(accountId);
        set({ currentAccount: account });
        await get().fetchAccounts();
        return account;
    },

    syncCurrentFromClient: async () => {
        const result = await accountService.syncCurrentFromClient();
        if (result) {
            await get().fetchCurrentAccount();
        }
    },

    updateAccountTags: async (accountId: string, tags: string[]) => {
        const account = await accountService.updateAccountTags(accountId, tags);
        await get().fetchAccounts();
        return account;
    },
}));
