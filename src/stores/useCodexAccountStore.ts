import { create } from 'zustand';
import { CodexAccount } from '../types/codex';
import * as codexService from '../services/codexService';

interface CodexAccountState {
  accounts: CodexAccount[];
  currentAccount: CodexAccount | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  fetchAccounts: () => Promise<void>;
  fetchCurrentAccount: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<CodexAccount>;
  deleteAccount: (accountId: string) => Promise<void>;
  deleteAccounts: (accountIds: string[]) => Promise<void>;
  refreshQuota: (accountId: string) => Promise<void>;
  refreshAllQuotas: () => Promise<void>;
  importFromLocal: () => Promise<CodexAccount>;
  importFromJson: (jsonContent: string) => Promise<CodexAccount[]>;
  updateAccountTags: (accountId: string, tags: string[]) => Promise<CodexAccount>;
}

export const useCodexAccountStore = create<CodexAccountState>((set, get) => ({
  accounts: [],
  currentAccount: null,
  loading: false,
  error: null,
  
  fetchAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const accounts = await codexService.listCodexAccounts();
      set({ accounts, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  
  fetchCurrentAccount: async () => {
    try {
      const currentAccount = await codexService.getCurrentCodexAccount();
      set({ currentAccount });
    } catch (e) {
      console.error('获取当前 Codex 账号失败:', e);
    }
  },
  
  switchAccount: async (accountId: string) => {
    const account = await codexService.switchCodexAccount(accountId);
    set({ currentAccount: account });
    await get().fetchAccounts();
    return account;
  },
  
  deleteAccount: async (accountId: string) => {
    await codexService.deleteCodexAccount(accountId);
    await get().fetchAccounts();
    await get().fetchCurrentAccount();
  },
  
  deleteAccounts: async (accountIds: string[]) => {
    await codexService.deleteCodexAccounts(accountIds);
    await get().fetchAccounts();
    await get().fetchCurrentAccount();
  },
  
  refreshQuota: async (accountId: string) => {
    await codexService.refreshCodexQuota(accountId);
    await get().fetchAccounts();
  },
  
  refreshAllQuotas: async () => {
    await codexService.refreshAllCodexQuotas();
    await get().fetchAccounts();
  },
  
  importFromLocal: async () => {
    const account = await codexService.importCodexFromLocal();
    await get().fetchAccounts();
    return account;
  },
  
  importFromJson: async (jsonContent: string) => {
    const accounts = await codexService.importCodexFromJson(jsonContent);
    await get().fetchAccounts();
    return accounts;
  },

  updateAccountTags: async (accountId: string, tags: string[]) => {
    const account = await codexService.updateCodexAccountTags(accountId, tags);
    await get().fetchAccounts();
    return account;
  },
}));
