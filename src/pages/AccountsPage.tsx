import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import {
  Plus,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Rocket,
  X,
  Globe,
  KeyRound,
  Database,
  Plug,
  Copy,
  Check,
  LayoutGrid,
  List,
  Search,
  Fingerprint,
  AlarmClock,
  Link,
  CircleAlert,
  Play,
  RotateCw,
  Package,
  ArrowDownWideNarrow,
  Tag,
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { useAccountStore } from '../stores/useAccountStore';
import * as accountService from '../services/accountService';
import { FingerprintWithStats, Account } from '../types/account';
import { Page } from '../types/navigation';
import { getQuotaClass, formatResetTimeDisplay, getSubscriptionTier, getDisplayModels, getModelShortName, matchModelName } from '../utils/account';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { GroupSettingsModal } from '../components/GroupSettingsModal';
import { TagEditModal } from '../components/TagEditModal';
import {
  GroupSettings,
  DisplayGroup,
  getDisplayGroups,
  calculateOverallQuota,
  calculateGroupQuota,
} from '../services/groupService';
import { RobotIcon } from '../components/icons/RobotIcon';

interface AccountsPageProps {
  onNavigate?: (page: Page) => void;
}

type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'PRO' | 'ULTRA' | 'FREE';

export function AccountsPage({ onNavigate }: AccountsPageProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'zh-CN';
  const untaggedKey = '__untagged__';
  const { accounts, currentAccount, loading, fetchAccounts, fetchCurrentAccount, deleteAccounts, refreshQuota, refreshAllQuotas, startOAuthLogin, switchAccount, updateAccountTags } = useAccountStore();

  // 视图模式
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  
  // 筛选
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [groupByTag, setGroupByTag] = useState(false);
  const [showTagFilter, setShowTagFilter] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'oauth' | 'token' | 'import'>('oauth');
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshWarnings, setRefreshWarnings] = useState<Record<string, { kind: 'auth' | 'error'; message: string }>>({});
  const [message, setMessage] = useState<{ text: string; tone?: 'error' } | null>(null);
  const [addStatus, setAddStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [addMessage, setAddMessage] = useState('');
  const [oauthUrl, setOauthUrl] = useState('');
  const [oauthUrlCopied, setOauthUrlCopied] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  
  // 指纹选择弹框
  const [fingerprints, setFingerprints] = useState<FingerprintWithStats[]>([]);
  const [showFpSelectModal, setShowFpSelectModal] = useState<string | null>(null);
  const [selectedFpId, setSelectedFpId] = useState<string | null>(null);
  const originalFingerprint = fingerprints.find((fp) => fp.is_original);
  const selectableFingerprints = fingerprints.filter((fp) => !fp.is_original);

  // Quota Detail Modal
  const [showQuotaModal, setShowQuotaModal] = useState<string | null>(null);

  // 标签编辑弹窗
  const [showTagModal, setShowTagModal] = useState<string | null>(null);
  
  // 分组管理
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [displayGroups, setDisplayGroups] = useState<DisplayGroup[]>([]);
  const [sortBy, setSortBy] = useState<'overall' | 'created_at' | string>('overall');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const resetSortPrefix = 'reset:';
  
  const showAddModalRef = useRef(showAddModal);
  const addTabRef = useRef(addTab);
  const oauthUrlRef = useRef(oauthUrl);
  const addStatusRef = useRef(addStatus);
  const tagFilterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    showAddModalRef.current = showAddModal;
    addTabRef.current = addTab;
    oauthUrlRef.current = oauthUrl;
    addStatusRef.current = addStatus;
  }, [showAddModal, addTab, oauthUrl, addStatus]);

  // 获取账号的配额数据 (modelId -> percentage)
  const getAccountQuotas = (account: Account): Record<string, number> => {
    const quotas: Record<string, number> = {};
    if (account.quota?.models) {
      for (const model of account.quota.models) {
        quotas[model.name] = model.percentage;
      }
    }
    return quotas;
  };

  const getGroupResetTimestamp = (account: Account, group: DisplayGroup): number | null => {
    if (!account.quota?.models?.length) {
      return null;
    }
    const groupModelIds = group.models.map((id) => id.toLowerCase());
    let earliest: number | null = null;
    for (const model of account.quota.models) {
      const modelName = model.name.toLowerCase();
      const belongsToGroup = groupModelIds.some((id) => matchModelName(modelName, id));
      if (!belongsToGroup) {
        continue;
      }
      const parsed = new Date(model.reset_time);
      if (Number.isNaN(parsed.getTime())) {
        continue;
      }
      const timestamp = parsed.getTime();
      if (earliest === null || timestamp < earliest) {
        earliest = timestamp;
      }
    }
    return earliest;
  };

  // 根据分组配置获取模型所属分组的名称
  const getGroupNameForModel = (modelId: string): string | null => {
    for (const group of displayGroups) {
      if (group.models.includes(modelId)) {
        return group.name;
      }
    }
    return null;
  };

  // 获取模型显示名称（优先使用分组名，否则使用默认短名）
  const getModelDisplayLabel = (modelId: string): string => {
    const groupName = getGroupNameForModel(modelId);
    return groupName || getModelShortName(modelId);
  };

  const normalizeTag = (tag: string) => tag.trim().toLowerCase();

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((account) => {
      (account.tags || []).forEach((tag) => {
        const normalized = normalizeTag(tag);
        if (normalized) set.add(normalized);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  // 筛选后的账号
  const filteredAccounts = useMemo(() => {
    let result = [...accounts];
    
    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(acc => acc.email.toLowerCase().includes(query));
    }
    
    // 类型过滤
    if (filterType !== 'all') {
      result = result.filter(acc => getSubscriptionTier(acc.quota) === filterType);
    }

    // 标签过滤
    if (tagFilter.length > 0) {
      const selectedTags = new Set(tagFilter.map(normalizeTag));
      result = result.filter((acc) => {
        const tags = (acc.tags || []).map(normalizeTag);
        return tags.some((tag) => selectedTags.has(tag));
      });
    }
    
    // 排序逻辑
    if (sortBy === 'created_at') {
      // 按创建时间排序
      result.sort((a, b) => {
        const diff = b.created_at - a.created_at;
        return sortDirection === 'desc' ? diff : -diff;
      });
    } else if (sortBy.startsWith(resetSortPrefix) && displayGroups.length > 0) {
      const targetGroupId = sortBy.slice(resetSortPrefix.length);
      const targetGroup = displayGroups.find((group) => group.id === targetGroupId);
      if (targetGroup) {
        result.sort((a, b) => {
          const aReset = getGroupResetTimestamp(a, targetGroup);
          const bReset = getGroupResetTimestamp(b, targetGroup);
          if (aReset === null && bReset === null) return 0;
          if (aReset === null) return 1;
          if (bReset === null) return -1;
          const diff = bReset - aReset;
          return sortDirection === 'desc' ? diff : -diff;
        });
      }
    } else if (sortBy !== 'default' && sortBy !== 'overall' && displayGroups.length > 0) {
      // 按指定分组配额排序，相同配额按总配额再排序
      const groupSettings: GroupSettings = {
        groupMappings: {},
        groupNames: {},
        groupOrder: displayGroups.map(g => g.id),
        updatedAt: 0,
        updatedBy: 'desktop',
      };
      // 从 displayGroups 构建 groupMappings
      for (const group of displayGroups) {
        groupSettings.groupNames[group.id] = group.name;
        for (const modelId of group.models) {
          groupSettings.groupMappings[modelId] = group.id;
        }
      }
      
      result.sort((a, b) => {
        const aGroupQuota = calculateGroupQuota(sortBy, getAccountQuotas(a), groupSettings) ?? 0;
        const bGroupQuota = calculateGroupQuota(sortBy, getAccountQuotas(b), groupSettings) ?? 0;
        
        // 如果分组配额不同，按分组配额排序
        if (aGroupQuota !== bGroupQuota) {
          const diff = bGroupQuota - aGroupQuota;
          return sortDirection === 'desc' ? diff : -diff;
        }
        
        // 分组配额相同，按总配额排序
        const aOverall = calculateOverallQuota(getAccountQuotas(a));
        const bOverall = calculateOverallQuota(getAccountQuotas(b));
        const diff = bOverall - aOverall;
        return sortDirection === 'desc' ? diff : -diff;
      });
    } else {
      // 默认按综合配额排序
      result.sort((a, b) => {
        const aQuota = calculateOverallQuota(getAccountQuotas(a));
        const bQuota = calculateOverallQuota(getAccountQuotas(b));
        const diff = bQuota - aQuota;
        return sortDirection === 'desc' ? diff : -diff;
      });
    }
    
    return result;
  }, [accounts, searchQuery, filterType, tagFilter, currentAccount, sortBy, sortDirection, displayGroups]);

  const groupedAccounts = useMemo(() => {
    if (!groupByTag) return [] as Array<[string, typeof filteredAccounts]>;
    const groups = new Map<string, typeof filteredAccounts>();
    const selectedTags = new Set(tagFilter.map(normalizeTag));

    filteredAccounts.forEach((account) => {
      const tags = (account.tags || []).map(normalizeTag).filter(Boolean);
      const matchedTags = selectedTags.size > 0
        ? tags.filter((tag) => selectedTags.has(tag))
        : tags;

      if (matchedTags.length === 0) {
        if (!groups.has(untaggedKey)) groups.set(untaggedKey, []);
        groups.get(untaggedKey)?.push(account);
        return;
      }

      matchedTags.forEach((tag) => {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)?.push(account);
      });
    });

    return Array.from(groups.entries()).sort(([aKey], [bKey]) => {
      if (aKey === untaggedKey) return 1;
      if (bKey === untaggedKey) return -1;
      return aKey.localeCompare(bKey);
    });
  }, [filteredAccounts, groupByTag, tagFilter, untaggedKey]);

  // 统计数量
  const tierCounts = useMemo(() => {
    const counts = { all: accounts.length, PRO: 0, ULTRA: 0, FREE: 0 };
    accounts.forEach(acc => {
      const tier = getSubscriptionTier(acc.quota);
      if (tier === 'PRO') counts.PRO++;
      else if (tier === 'ULTRA') counts.ULTRA++;
      else counts.FREE++;
    });
    return counts;
  }, [accounts]);

  const loadFingerprints = async () => {
    try {
      const list = await accountService.listFingerprints();
      setFingerprints(list);
    } catch (e) { console.error(e); }
  };

  // 加载显示用分组配置
  const loadDisplayGroups = async () => {
    try {
      const groups = await getDisplayGroups();
      setDisplayGroups(groups);
    } catch (e) { console.error('Failed to load display groups:', e); }
  };

  useEffect(() => {
    fetchAccounts();
    fetchCurrentAccount();
    loadFingerprints();
    loadDisplayGroups();
    
    let unlisten: UnlistenFn | undefined;
    let unlistenGroups: UnlistenFn | undefined;
    
    listen<string>('accounts:refresh', async () => {
      await fetchAccounts();
      await fetchCurrentAccount();
      const latestAccounts = useAccountStore.getState().accounts;
      const accountsWithoutQuota = latestAccounts.filter(acc => !acc.quota?.models?.length);
      if (accountsWithoutQuota.length > 0) {
        await Promise.allSettled(accountsWithoutQuota.map(acc => refreshQuota(acc.id)));
        await fetchAccounts();
      }
    }).then(fn => { unlisten = fn; });
    
    // 监听分组配置变更
    listen('group_settings:changed', async () => {
      await loadDisplayGroups();
    }).then(fn => { unlistenGroups = fn; });
    
    return () => {
      if (unlisten) unlisten();
      if (unlistenGroups) unlistenGroups();
    };
  }, [fetchAccounts, fetchCurrentAccount, refreshQuota]);

  useEffect(() => {
    if (!showTagFilter) return;
    const handleClick = (event: MouseEvent) => {
      if (!tagFilterRef.current) return;
      if (!tagFilterRef.current.contains(event.target as Node)) {
        setShowTagFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTagFilter]);

  useEffect(() => {
    let unlistenUrl: UnlistenFn | undefined;
    let unlistenCallback: UnlistenFn | undefined;

    listen<string>('oauth-url-generated', (event) => {
      setOauthUrl(String(event.payload || ''));
    }).then((fn) => { unlistenUrl = fn; });

    listen('oauth-callback-received', async () => {
      if (!showAddModalRef.current) return;
      if (addTabRef.current !== 'oauth') return;
      if (addStatusRef.current === 'loading') return;
      if (!oauthUrlRef.current) return;

      setAddStatus('loading');
      setAddMessage(t('accounts.oauth.authorizing'));
      try {
        await accountService.completeOAuthLogin();
        await fetchAccounts();
        await fetchCurrentAccount();
        setAddStatus('success');
        setAddMessage(t('accounts.oauth.success'));
        setTimeout(() => {
          setShowAddModal(false);
          setAddStatus('idle');
          setAddMessage('');
          setOauthUrl('');
        }, 1200);
      } catch (e) {
        setAddStatus('error');
        setAddMessage(t('accounts.oauth.failed', { error: String(e) }));
      }
    }).then((fn) => { unlistenCallback = fn; });

    return () => {
      if (unlistenUrl) unlistenUrl();
      if (unlistenCallback) unlistenCallback();
    };
  }, [fetchAccounts, fetchCurrentAccount]);

  useEffect(() => {
    if (!showAddModal || addTab !== 'oauth' || oauthUrl) return;
    accountService.prepareOAuthUrl()
      .then((url) => {
        if (typeof url === 'string' && url.length > 0) {
          setOauthUrl(url);
        }
      })
      .catch((e) => {
        console.error('准备 OAuth 链接失败:', e);
      });
  }, [showAddModal, addTab, oauthUrl]);

  useEffect(() => {
    if (showAddModal && addTab === 'oauth') return;
    if (!oauthUrl) return;
    accountService.cancelOAuthLogin().catch(() => {});
    setOauthUrl('');
    setOauthUrlCopied(false);
  }, [showAddModal, addTab, oauthUrl]);

  const handleRefresh = async (accountId: string) => {
    setRefreshing(accountId);
    try {
      await refreshQuota(accountId);
      const target = accounts.find(acc => acc.id === accountId);
      if (target) {
        setRefreshWarnings((prev) => {
          if (!prev[target.email]) return prev;
          const next = { ...prev };
          delete next[target.email];
          return next;
        });
      }
    } catch (e) {
      console.error(e);
      const target = accounts.find(acc => acc.id === accountId);
      if (target) {
        const reason = normalizeWarningMessage(String(e));
        setRefreshWarnings((prev) => ({
          ...prev,
          [target.email]: {
            kind: isAuthFailure(reason) ? 'auth' : 'error',
            message: reason,
          },
        }));
      }
    } finally {
      setRefreshing(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      const stats = await refreshAllQuotas();
      setRefreshWarnings(buildWarningMapFromDetails(stats.details || []));
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleDelete = (accountId: string) => {
    setDeleteConfirm({
      ids: [accountId],
      message: t('messages.deleteConfirm'),
    });
  };

  const handleBatchDelete = () => {
    if (selected.size === 0) return;
    setDeleteConfirm({
      ids: Array.from(selected),
      message: t('messages.batchDeleteConfirm', { count: selected.size }),
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm || deleting) return;
    setDeleting(true);
    try {
      await deleteAccounts(deleteConfirm.ids);
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        deleteConfirm.ids.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  const resetAddModalState = () => {
    setAddStatus('idle');
    setAddMessage('');
    setTokenInput('');
    setOauthUrlCopied(false);
  };

  const openAddModal = (tab: 'oauth' | 'token' | 'import') => {
    setAddTab(tab);
    setShowAddModal(true);
    resetAddModalState();
  };

  const closeAddModal = () => {
    // 允许用户随时关闭弹窗，取消正在进行的 OAuth 流程
    if (addStatus === 'loading') {
      accountService.cancelOAuthLogin().catch(() => {});
    }
    setShowAddModal(false);
    resetAddModalState();
    setOauthUrl('');
  };

  const runModalAction = async (label: string, action: () => Promise<void>, closeOnSuccess = true) => {
    setAddStatus('loading');
    setAddMessage(t('messages.actionRunning', { action: label }));
    try {
      await action();
      setAddStatus('success');
      setAddMessage(t('messages.actionSuccess', { action: label }));
      if (closeOnSuccess) {
        setTimeout(() => {
          setShowAddModal(false);
          resetAddModalState();
        }, 1200);
      }
    } catch (e) {
      setAddStatus('error');
      setAddMessage(t('messages.actionFailed', { action: label, error: String(e) }));
    }
  };

  const handleOAuthStart = async () => {
    await runModalAction(t('modals.import.oauthAction'), async () => {
      await startOAuthLogin();
      await fetchAccounts();
      await fetchCurrentAccount();
    });
  };

  const handleOAuthComplete = async () => {
    await runModalAction(t('modals.import.oauthAction'), async () => {
      await accountService.completeOAuthLogin();
      await fetchAccounts();
      await fetchCurrentAccount();
    });
  };

  const handleSwitch = async (accountId: string) => {
    setMessage(null);
    setSwitching(accountId);
    try {
      const account = await switchAccount(accountId);
      await fetchCurrentAccount();
      setMessage({ text: t('messages.switched', { email: account.email }) });
    } catch (e) {
      setMessage({ text: t('messages.switchFailed', { error: String(e) }), tone: 'error' });
    }
    setSwitching(null);
  };

  const handleImportFromTools = async () => {
    setImporting(true);
    setAddStatus('loading');
    setAddMessage(t('modals.import.importingTools'));
    try {
      const imported = await accountService.importFromOldTools();
      await fetchAccounts();
      await loadFingerprints();
      await Promise.allSettled(imported.map(acc => refreshQuota(acc.id)));
      await fetchAccounts();
      if (imported.length === 0) {
        setAddStatus('error');
        setAddMessage(t('modals.import.noAccountsFound'));
      } else {
        setAddStatus('success');
        setAddMessage(t('messages.importSuccess', { count: imported.length }));
        setTimeout(() => {
          setShowAddModal(false);
          resetAddModalState();
        }, 1200);
      }
    } catch (e) {
      setAddStatus('error');
      setAddMessage(t('messages.importFailed', { error: String(e) }));
    }
    setImporting(false);
  };
  
  const handleImportFromLocal = async () => {
    setImporting(true);
    setAddStatus('loading');
    setAddMessage(t('modals.import.importingLocal'));
    try {
      const imported = await accountService.importFromLocal();
      await fetchAccounts();
      await refreshQuota(imported.id);
      await fetchAccounts();
      setAddStatus('success');
      setAddMessage(t('messages.importLocalSuccess', { email: imported.email }));
      setTimeout(() => {
        setShowAddModal(false);
        resetAddModalState();
      }, 1200);
    } catch (e) {
      setAddStatus('error');
      setAddMessage(t('messages.importFailed', { error: String(e) }));
    }
    setImporting(false);
  };

  const handleImportFromExtension = async () => {
    setImporting(true);
    setAddStatus('loading');
    setAddMessage(t('modals.import.importingExtension'));
    try {
      const count = await accountService.syncFromExtension();
      await fetchAccounts();
      if (count === 0) {
        setAddStatus('error');
        setAddMessage(t('modals.import.noAccountsFound'));
      } else {
        setAddStatus('success');
        setAddMessage(t('messages.importSuccess', { count }));
        setTimeout(() => {
          setShowAddModal(false);
          resetAddModalState();
        }, 1200);
      }
    } catch (e) {
      setAddStatus('error');
      setAddMessage(t('messages.importFailed', { error: String(e) }));
    }
    setImporting(false);
  };

  const extractRefreshTokens = (input: string) => {
    const tokens: string[] = [];
    const trimmed = input.trim();
    if (!trimmed) return tokens;

    try {
      const parsed = JSON.parse(trimmed);
      const pushToken = (value: unknown) => {
        if (typeof value === 'string' && value.startsWith('1//')) {
          tokens.push(value);
        }
      };

      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (typeof item === 'string') {
            pushToken(item);
            return;
          }
          if (item && typeof item === 'object') {
            const token = (item as { refresh_token?: string; refreshToken?: string }).refresh_token
              || (item as { refresh_token?: string; refreshToken?: string }).refreshToken;
            pushToken(token);
          }
        });
      } else if (parsed && typeof parsed === 'object') {
        const token = (parsed as { refresh_token?: string; refreshToken?: string }).refresh_token
          || (parsed as { refresh_token?: string; refreshToken?: string }).refreshToken;
        pushToken(token);
      }
    } catch {
      // ignore JSON parse errors, fallback to regex
    }

    if (tokens.length === 0) {
      const matches = trimmed.match(/1\/\/[a-zA-Z0-9_\-]+/g);
      if (matches) tokens.push(...matches);
    }

    return Array.from(new Set(tokens));
  };

  const handleTokenImport = async () => {
    const tokens = extractRefreshTokens(tokenInput);
    if (tokens.length === 0) {
      setAddStatus('error');
      setAddMessage(t('accounts.token.invalid'));
      return;
    }

    setImporting(true);
    setAddStatus('loading');
    let success = 0;
    let fail = 0;
    const importedAccounts: Account[] = [];

    for (let i = 0; i < tokens.length; i += 1) {
      setAddMessage(t('accounts.token.importProgress', { current: i + 1, total: tokens.length }));
      try {
        const account = await accountService.addAccountWithToken(tokens[i]);
        importedAccounts.push(account);
        success += 1;
      } catch (e) {
        console.error('Token 导入失败:', e);
        fail += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (importedAccounts.length > 0) {
      await Promise.allSettled(importedAccounts.map((acc) => refreshQuota(acc.id)));
      await fetchAccounts();
    }

    if (success === tokens.length) {
      setAddStatus('success');
      setAddMessage(t('accounts.token.importSuccess', { count: success }));
      setTimeout(() => {
        setShowAddModal(false);
        resetAddModalState();
      }, 1200);
    } else if (success > 0) {
      setAddStatus('success');
      setAddMessage(t('accounts.token.importPartial', { success, fail }));
    } else {
      setAddStatus('error');
      setAddMessage(t('accounts.token.importFailed'));
    }

    setImporting(false);
  };

  const handleCopyOauthUrl = async () => {
    if (!oauthUrl) return;
    try {
      await navigator.clipboard.writeText(oauthUrl);
      setOauthUrlCopied(true);
      window.setTimeout(() => setOauthUrlCopied(false), 1200);
    } catch (e) {
      console.error('复制失败:', e);
    }
  };

  const saveJsonFile = async (json: string, defaultFileName: string) => {
    const filePath = await save({
      defaultPath: defaultFileName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return null;
    await invoke('save_text_file', { path: filePath, content: json });
    return filePath;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const json = await accountService.exportAccounts(Array.from(selected));
      const defaultName = `accounts_export_${new Date().toISOString().slice(0, 10)}.json`;
      const savedPath = await saveJsonFile(json, defaultName);
      if (savedPath) {
        setMessage({ text: `${t('common.success')}: ${savedPath}` });
      }
    } catch (e) { alert(t('messages.exportFailed', { error: String(e) })); }
    setExporting(false);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredAccounts.length) setSelected(new Set());
    else setSelected(new Set(filteredAccounts.map((a) => a.id)));
  };

  const toggleTagFilterValue = (tag: string) => {
    setTagFilter((prev) => {
      if (prev.includes(tag)) return prev.filter((item) => item !== tag);
      return [...prev, tag];
    });
  };

  const clearTagFilter = () => {
    setTagFilter([]);
  };

  const openTagModal = (accountId: string) => {
    setShowTagModal(accountId);
  };

  const handleSaveTags = async (tags: string[]) => {
    if (!showTagModal) return;
    await updateAccountTags(showTagModal, tags);
    setShowTagModal(null);
  };

  const openFpSelectModal = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    setSelectedFpId(account?.fingerprint_id || 'original');
    setShowFpSelectModal(accountId);
  };

  const handleBindFingerprint = async () => {
    if (!showFpSelectModal || !selectedFpId) return;
    try {
      await accountService.bindAccountFingerprint(showFpSelectModal, selectedFpId);
      await fetchAccounts();
      setShowFpSelectModal(null);
    } catch (e) { alert(t('messages.bindFailed', { error: String(e) })); }
  };

  const getFingerprintName = (fpId?: string) => {
    if (!fpId || fpId === 'original') return t('modals.fingerprint.original');
    const fp = fingerprints.find(f => f.id === fpId);
    return fp?.name || fpId;
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }) +
           ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  };

  const normalizeWarningMessage = (raw: string) => raw.replace(/^Error:\s*/i, '').trim();

  const isAuthFailure = (message: string) => {
    const lower = message.toLowerCase();
    return lower.includes('invalid_grant')
      || lower.includes('unauthorized')
      || lower.includes('unauthenticated')
      || lower.includes('invalid authentication')
      || lower.includes('401');
  };

  const parseRefreshDetail = (detail: string): { email: string; reason: string } | null => {
    const match = detail.match(/^Account\s+(.+?):\s+(.+)$/);
    if (!match) return null;
    const email = match[1].trim();
    let reason = match[2].trim();
    reason = reason.replace(/^Fetch quota failed\s*-\s*/i, '');
    reason = reason.replace(/^Save quota failed\s*-\s*/i, '');
    return { email, reason };
  };

  const buildWarningMapFromDetails = (details: string[]) => {
    const next: Record<string, { kind: 'auth' | 'error'; message: string }> = {};
    details.forEach((detail) => {
      const parsed = parseRefreshDetail(detail);
      if (!parsed) return;
      const reason = normalizeWarningMessage(parsed.reason);
      next[parsed.email] = {
        kind: isAuthFailure(reason) ? 'auth' : 'error',
        message: reason,
      };
    });
    return next;
  };

  useEffect(() => {
    if (Object.keys(refreshWarnings).length === 0) return;
    const existing = new Set(accounts.map(acc => acc.email));
    setRefreshWarnings((prev) => {
      let changed = false;
      const next: Record<string, { kind: 'auth' | 'error'; message: string }> = {};
      Object.entries(prev).forEach(([email, warning]) => {
        if (existing.has(email)) {
          next[email] = warning;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [accounts, refreshWarnings]);

  const resolveGroupLabel = (groupKey: string) =>
    groupKey === untaggedKey ? t('accounts.untagged', '未分组') : groupKey;

  const renderGridCards = (items: Account[], groupKey?: string) =>
    items.map((account) => {
      const isCurrent = currentAccount?.id === account.id;
      const tier = getSubscriptionTier(account.quota);
      const tierLabel = t(`accounts.tier.${tier.toLowerCase()}`, tier);
      const displayModels = getDisplayModels(account.quota);
      const isDisabled = account.disabled;
      const isSelected = selected.has(account.id);
      const warning = refreshWarnings[account.email];
      const warningLabel = warning?.kind === 'auth'
        ? t('accounts.status.authInvalid')
        : t('accounts.status.refreshFailed');
      const warningTitle = warning?.message || '';
      const disabledTitle = isDisabled
        ? `${t('accounts.status.disabled')}${account.disabled_reason ? `: ${account.disabled_reason}` : ''}`
        : '';

      if (displayModels.length === 0) {
        console.log('[AccountsPage] 账号无配额数据:', {
          email: account.email,
          isCurrent,
          hasQuota: !!account.quota,
          quotaModels: account.quota?.models,
          quotaModelsLength: account.quota?.models?.length,
          rawQuota: account.quota,
        });
      }

      return (
        <div key={groupKey ? `${groupKey}-${account.id}` : account.id} className={`account-card ${isCurrent ? 'current' : ''} ${isDisabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}>
          <div className="card-top">
            <div className="card-select">
              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(account.id)} />
            </div>
            <span className="account-email" title={account.email}>{account.email}</span>
            {isCurrent && <span className="current-tag">{t('accounts.status.current')}</span>}
            {warning && (
              <span className="status-pill warning" title={warningTitle}>
                <CircleAlert size={12} />
                {warningLabel}
              </span>
            )}
            {isDisabled && (
              <span className="status-pill disabled" title={disabledTitle}>
                <CircleAlert size={12} />
                {t('accounts.status.disabled')}
              </span>
            )}
            <span className={`tier-badge ${tier.toLowerCase()}`}>{tierLabel}</span>
          </div>

          <div className="card-quota-grid">
            {displayModels.map((model) => {
              const resetLabel = formatResetTimeDisplay(model.reset_time, t);
              return (
                <div key={model.name} className="quota-compact-item">
                  <div className="quota-compact-header">
                    <span className="model-label">{getModelDisplayLabel(model.name)}</span>
                    <span className={`model-pct ${getQuotaClass(model.percentage)}`}>{model.percentage}%</span>
                  </div>
                  <div className="quota-compact-bar-track">
                    <div
                      className={`quota-compact-bar ${getQuotaClass(model.percentage)}`}
                      style={{ width: `${model.percentage}%` }}
                    />
                  </div>
                  {resetLabel && <span className="quota-compact-reset">{resetLabel}</span>}
                </div>
              );
            })}
            {displayModels.length === 0 && (
              <div className="quota-empty">{t('overview.noQuotaData')}</div>
            )}
          </div>

          <div className="card-footer">
            <span className="card-date">{formatDate(account.created_at)}</span>
            <div className="card-actions">
              <button className="card-action-btn" onClick={() => setShowQuotaModal(account.id)} title={t('accounts.actions.viewDetails')}>
                <CircleAlert size={14} />
              </button>
              <button className="card-action-btn" onClick={() => openFpSelectModal(account.id)} title={t('accounts.actions.fingerprint')}>
                <Fingerprint size={14} />
              </button>
              <button
                className="card-action-btn"
                onClick={() => openTagModal(account.id)}
                title={t('accounts.editTags', '编辑标签')}
              >
                <Tag size={14} />
              </button>
              <button
                className={`card-action-btn ${!isCurrent ? 'success' : ''}`}
                onClick={() => handleSwitch(account.id)}
                disabled={!!switching}
                title={isCurrent ? t('accounts.actions.switch') : t('accounts.actions.switchTo')}
              >
                {switching === account.id ? <RefreshCw size={14} className="loading-spinner" /> : <Play size={14} />}
              </button>
              <button
                className="card-action-btn"
                onClick={() => handleRefresh(account.id)}
                disabled={refreshing === account.id}
                title={t('accounts.refreshQuota')}
              >
                <RotateCw size={14} className={refreshing === account.id ? 'loading-spinner' : ''} />
              </button>
              <button className="card-action-btn export-btn" onClick={() => handleExportSingle(account)} title={t('accounts.export')}>
                <Upload size={14} />
              </button>
              <button className="card-action-btn danger" onClick={() => handleDelete(account.id)} title={t('common.delete')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      );
    });

  // 渲染卡片视图
  const renderGridView = () => {
    if (!groupByTag) {
      return (
        <div className="accounts-grid">
          {renderGridCards(filteredAccounts)}
        </div>
      );
    }

    return (
      <div className="tag-group-list">
        {groupedAccounts.map(([groupKey, groupAccounts]) => (
          <div key={groupKey} className="tag-group-section">
            <div className="tag-group-header">
              <span className="tag-group-title">{resolveGroupLabel(groupKey)}</span>
              <span className="tag-group-count">{groupAccounts.length}</span>
            </div>
            <div className="tag-group-grid accounts-grid">
              {renderGridCards(groupAccounts, groupKey)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const handleExportSingle = async (account: Account) => {
    try {
      const json = await accountService.exportAccounts([account.id]);
      const defaultName = `${account.email.split('@')[0]}_${new Date().toISOString().slice(0, 10)}.json`;
      const savedPath = await saveJsonFile(json, defaultName);
      if (savedPath) {
        setMessage({ text: `${t('common.success')}: ${savedPath}` });
      }
    } catch (e) { alert(t('messages.exportFailed', { error: String(e) })); }
  };

  const renderListRows = (items: Account[], groupKey?: string) =>
    items.map((account) => {
      const isCurrent = currentAccount?.id === account.id;
      const tier = getSubscriptionTier(account.quota);
      const tierLabel = t(`accounts.tier.${tier.toLowerCase()}`, tier);
      const displayModels = getDisplayModels(account.quota);
      const warning = refreshWarnings[account.email];
      const warningLabel = warning?.kind === 'auth'
        ? t('accounts.status.authInvalid')
        : t('accounts.status.refreshFailed');
      const warningTitle = warning?.message || '';
      const disabledTitle = account.disabled
        ? `${t('accounts.status.disabled')}${account.disabled_reason ? `: ${account.disabled_reason}` : ''}`
        : '';

      return (
        <tr key={groupKey ? `${groupKey}-${account.id}` : account.id} className={isCurrent ? 'current' : ''}>
          <td>
            <input
              type="checkbox"
              checked={selected.has(account.id)}
              onChange={() => toggleSelect(account.id)}
            />
          </td>
          <td>
            <div className="account-cell">
              <div className="account-main-line">
                <span className="account-email-text" title={account.email}>{account.email}</span>
                {isCurrent && <span className="mini-tag current">{t('accounts.status.current')}</span>}
              </div>
              <div className="account-sub-line">
                <span className={`tier-badge ${tier.toLowerCase()}`}>{tierLabel}</span>
                {warning && (
                  <span className="status-pill warning" title={warningTitle}>
                    <CircleAlert size={12} />
                    {warningLabel}
                  </span>
                )}
                {account.disabled && (
                  <span className="status-pill disabled" title={disabledTitle}>
                    <CircleAlert size={12} />
                    {t('accounts.status.disabled')}
                  </span>
                )}
              </div>
            </div>
          </td>
          <td>
            <button className="fp-select-btn" onClick={() => openFpSelectModal(account.id)} title={t('accounts.actions.selectFingerprint')}>
              <Fingerprint size={14} />
              <span className="fp-select-name">{getFingerprintName(account.fingerprint_id)}</span>
              <Link size={12} />
            </button>
          </td>
          <td>
            <div className="quota-grid">
              {displayModels.map((model) => (
                <div className="quota-item" key={model.name}>
                  <div className="quota-header">
                    <span className="quota-name">{getModelDisplayLabel(model.name)}</span>
                    <span className={`quota-value ${getQuotaClass(model.percentage)}`}>{model.percentage}%</span>
                  </div>
                  <div className="quota-progress-track">
                    <div
                      className={`quota-progress-bar ${getQuotaClass(model.percentage)}`}
                      style={{ width: `${model.percentage}%` }}
                    />
                  </div>
                  <div className="quota-footer">
                    <span className="quota-reset">{formatResetTimeDisplay(model.reset_time, t)}</span>
                  </div>
                </div>
              ))}
              {displayModels.length === 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {t('overview.noQuotaData')}
                </span>
              )}
            </div>
          </td>
          <td className="sticky-action-cell table-action-cell">
            <div className="action-buttons">
              <button className="action-btn" onClick={() => setShowQuotaModal(account.id)} title={t('accounts.actions.viewDetails')}>
                <CircleAlert size={16} />
              </button>
              <button
                className="action-btn"
                onClick={() => openTagModal(account.id)}
                title={t('accounts.editTags', '编辑标签')}
              >
                <Tag size={16} />
              </button>
              <button
                className={`action-btn ${!isCurrent ? 'success' : ''}`}
                onClick={() => handleSwitch(account.id)}
                disabled={!!switching}
                title={isCurrent ? t('accounts.actions.switch') : t('accounts.actions.switchTo')}
              >
                {switching === account.id ? <div className="loading-spinner" style={{ width: 14, height: 14 }} /> : <Play size={16} />}
              </button>
              <button className="action-btn" onClick={() => handleRefresh(account.id)} disabled={refreshing === account.id} title={t('accounts.refreshQuota')}>
                <RotateCw size={16} className={refreshing === account.id ? 'loading-spinner' : ''} />
              </button>
              <button className="action-btn danger" onClick={() => handleDelete(account.id)} title={t('common.delete')}>
                <Trash2 size={16} />
              </button>
            </div>
          </td>
        </tr>
      );
    });

  // 渲染列表视图
  const renderListView = () => (
    <div className={`account-table-container${groupByTag ? ' grouped' : ''}`}>
      <table className="account-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <input
                type="checkbox"
                checked={selected.size === filteredAccounts.length && filteredAccounts.length > 0}
                onChange={toggleSelectAll}
              />
            </th>
            <th style={{ width: 220 }}>{t('accounts.columns.email')}</th>
            <th style={{ width: 130 }}>{t('accounts.columns.fingerprint')}</th>
            <th>{t('accounts.columns.quota')}</th>
            <th className="sticky-action-header table-action-header">{t('accounts.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {groupByTag
            ? groupedAccounts.map(([groupKey, groupAccounts]) => (
                <Fragment key={groupKey}>
                  <tr className="tag-group-row">
                    <td colSpan={5}>
                      <div className="tag-group-header">
                        <span className="tag-group-title">{resolveGroupLabel(groupKey)}</span>
                        <span className="tag-group-count">{groupAccounts.length}</span>
                      </div>
                    </td>
                  </tr>
                  {renderListRows(groupAccounts, groupKey)}
                </Fragment>
              ))
            : renderListRows(filteredAccounts)}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <main className="main-content accounts-page">
        <div className="page-tabs-row">
          <div className="page-tabs-label">{t('overview.brandTitle')}</div>
          <div className="page-tabs filter-tabs">
            <button
              className="filter-tab active"
              onClick={() => onNavigate?.('overview')}
            >
              <RobotIcon className="tab-icon" />
              <span>{t('overview.title')}</span>
            </button>
            <button
              className="filter-tab"
              onClick={() => onNavigate?.('fingerprints')}
            >
              <Fingerprint className="tab-icon" />
              <span>{t('fingerprints.title')}</span>
            </button>
            <button
              className="filter-tab"
              onClick={() => onNavigate?.('wakeup')}
            >
              <AlarmClock className="tab-icon" />
              <span>{t('wakeup.title')}</span>
            </button>
          </div>
        </div>

        {/* 工具栏 */}
        <div className="toolbar">
          <div className="toolbar-left">
            <div className="search-box">
              <Search size={16} className="search-icon" />
              <input 
                type="text" 
                placeholder={t('accounts.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="view-switcher">
              <button 
                className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title={t('accounts.view.list')}
              >
                <List size={16} />
              </button>
              <button 
                className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title={t('accounts.view.grid')}
              >
                <LayoutGrid size={16} />
              </button>
            </div>

            <div className="filter-select">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                aria-label={t('accounts.filterLabel')}
              >
                <option value="all">{t('accounts.filter.all', { count: tierCounts.all })}</option>
                <option value="PRO">{t('accounts.filter.pro', { count: tierCounts.PRO })}</option>
                <option value="ULTRA">{t('accounts.filter.ultra', { count: tierCounts.ULTRA })}</option>
                <option value="FREE">{t('accounts.filter.free', { count: tierCounts.FREE })}</option>
              </select>
            </div>

            <div className="tag-filter" ref={tagFilterRef}>
              <button
                type="button"
                className={`tag-filter-btn ${tagFilter.length > 0 ? 'active' : ''}`}
                onClick={() => setShowTagFilter((prev) => !prev)}
                aria-label={t('accounts.filterTags', '标签筛选')}
              >
                <Tag size={14} />
                {tagFilter.length > 0 ? `${t('accounts.filterTagsCount', '标签')}(${tagFilter.length})` : t('accounts.filterTags', '标签筛选')}
              </button>
              {showTagFilter && (
                <div className="tag-filter-panel">
                  {availableTags.length === 0 ? (
                    <div className="tag-filter-empty">{t('accounts.noAvailableTags', '暂无可用标签')}</div>
                  ) : (
                    <div className="tag-filter-options">
                      {availableTags.map((tag) => (
                        <label key={tag} className={`tag-filter-option ${tagFilter.includes(tag) ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={tagFilter.includes(tag)}
                            onChange={() => toggleTagFilterValue(tag)}
                          />
                          <span>{tag}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="tag-filter-divider" />
                  <label className="tag-filter-group-toggle">
                    <input
                      type="checkbox"
                      checked={groupByTag}
                      onChange={(e) => setGroupByTag(e.target.checked)}
                    />
                    <span>{t('accounts.groupByTag', '按标签分组展示')}</span>
                  </label>
                  {tagFilter.length > 0 && (
                    <button type="button" className="tag-filter-clear" onClick={clearTagFilter}>
                      {t('accounts.clearFilter', '清空筛选')}
                    </button>
                  )}
                </div>
              )}
            </div>
            
            {/* 排序下拉菜单 */}
            <div className="sort-select">
              <ArrowDownWideNarrow size={14} className="sort-icon" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label={t('accounts.sortLabel', '排序')}
              >
                <option value="overall">{t('accounts.sort.overall', '按综合配额')}</option>
                <option value="created_at">{t('accounts.sort.createdAt', '按创建时间')}</option>
                {displayGroups.map(group => (
                  <option key={group.id} value={group.id}>
                    {t('accounts.sort.byGroup', { group: group.name, defaultValue: `按 ${group.name} 配额` })}
                  </option>
                ))}
                {displayGroups.map(group => (
                  <option key={`${group.id}-reset`} value={`${resetSortPrefix}${group.id}`}>
                    {t('accounts.sort.byGroupReset', { group: group.name, defaultValue: `按 ${group.name} 重置时间` })}
                  </option>
                ))}
              </select>
            </div>
            
            {/* 排序方向切换按钮 */}
            <button
              className="sort-direction-btn"
              onClick={() => setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc')}
              title={sortDirection === 'desc' ? t('accounts.sort.descTooltip', '当前：降序，点击切换为升序') : t('accounts.sort.ascTooltip', '当前：升序，点击切换为降序')}
              aria-label={t('accounts.sort.toggleDirection', '切换排序方向')}
            >
              {sortDirection === 'desc' ? '⬇' : '⬆'}
            </button>
          </div>

          <div className="toolbar-right">
            <button
              className="btn btn-primary icon-only"
              onClick={() => openAddModal('oauth')}
              title={t('accounts.addAccount')}
              aria-label={t('accounts.addAccount')}
            >
              <Plus size={14} />
            </button>
            <button
              className="btn btn-secondary icon-only"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              title={t('accounts.refreshAll')}
              aria-label={t('accounts.refreshAll')}
            >
              <RefreshCw size={14} className={refreshingAll ? 'loading-spinner' : ''} />
            </button>
            <button
              className="btn btn-secondary icon-only"
              onClick={() => setShowGroupModal(true)}
              title={t('group_settings.title', '分组管理')}
              aria-label={t('group_settings.title', '分组管理')}
            >
              <Package size={14} />
            </button>
            <button
              className="btn btn-secondary icon-only"
              onClick={() => openAddModal('oauth')}
              disabled={importing}
              title={t('accounts.import')}
              aria-label={t('accounts.import')}
            >
              <Download size={14} />
            </button>
            <button
              className="btn btn-secondary export-btn icon-only"
              onClick={handleExport}
              disabled={exporting}
              title={selected.size > 0 ? `${t('accounts.export')} (${selected.size})` : t('accounts.export')}
              aria-label={selected.size > 0 ? `${t('accounts.export')} (${selected.size})` : t('accounts.export')}
            >
              <Upload size={14} />
            </button>
            {selected.size > 0 && (
              <button
                className="btn btn-danger icon-only"
                onClick={handleBatchDelete}
                title={`${t('common.delete')} (${selected.size})`}
                aria-label={`${t('common.delete')} (${selected.size})`}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {message && (
          <div className={`action-message${message.tone ? ` ${message.tone}` : ''}`}>
            <span className="action-message-text">{message.text}</span>
            <button className="action-message-close" onClick={() => setMessage(null)} aria-label={t('common.close')}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* 内容区域 */}
        {loading ? (
          <div className="empty-state"><div className="loading-spinner" style={{ width: 40, height: 40 }} /></div>
        ) : accounts.length === 0 ? (
          <div className="empty-state">
            <div className="icon"><Rocket size={40} /></div>
            <h3>{t('accounts.empty.title')}</h3>
            <p>{t('accounts.empty.desc')}</p>
            <button className="btn btn-primary" onClick={() => openAddModal('oauth')}>
              <Plus size={18} />{t('accounts.empty.btn')}
            </button>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="empty-state">
            <h3>{t('accounts.noMatch.title')}</h3>
            <p>{t('accounts.noMatch.desc')}</p>
          </div>
        ) : (
          viewMode === 'grid' ? renderGridView() : renderListView()
        )}
      </main>

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal modal-lg add-account-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('modals.addAccount.title')}</h2>
              <button className="close-btn" onClick={closeAddModal}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="add-tabs">
                <button
                  className={`add-tab ${addTab === 'oauth' ? 'active' : ''}`}
                  onClick={() => { setAddTab('oauth'); resetAddModalState(); }}
                >
                  <Globe size={14} /> {t('accounts.tabs.oauth')}
                </button>
                <button
                  className={`add-tab ${addTab === 'token' ? 'active' : ''}`}
                  onClick={() => { setAddTab('token'); resetAddModalState(); }}
                >
                  <KeyRound size={14} /> {t('accounts.tabs.token')}
                </button>
                <button
                  className={`add-tab ${addTab === 'import' ? 'active' : ''}`}
                  onClick={() => { setAddTab('import'); resetAddModalState(); }}
                >
                  <Database size={14} /> {t('accounts.tabs.import')}
                </button>
              </div>

              {addTab === 'oauth' && (
                <div className="add-panel">
                  <div className="oauth-hint">
                    <Globe size={18} />
                    <span>{t('accounts.oauth.hint')}</span>
                  </div>
                  <div className="oauth-actions">
                    <button className="btn btn-primary" onClick={handleOAuthStart} disabled={addStatus === 'loading'}>
                      <Globe size={16} /> {t('accounts.oauth.start')}
                    </button>
                    <button className="btn btn-secondary" onClick={handleOAuthComplete} disabled={!oauthUrl || addStatus === 'loading'}>
                      <Check size={16} /> {t('accounts.oauth.continue')}
                    </button>
                  </div>
                  <div className="oauth-link">
                    <label>{t('accounts.oauth.linkLabel')}</label>
                    <div className="oauth-link-row">
                      <input type="text" value={oauthUrl || t('accounts.oauth.generatingLink')} readOnly />
                      <button
                        className="btn btn-secondary icon-only"
                        onClick={handleCopyOauthUrl}
                        disabled={!oauthUrl}
                        title={t('common.copy')}
                      >
                        {oauthUrlCopied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {addTab === 'token' && (
                <div className="add-panel">
                  <p className="add-panel-desc">{t('accounts.token.desc')}</p>
                  <textarea
                    className="token-input"
                    placeholder={t('accounts.token.placeholder')}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    rows={6}
                  />
                  <div className="modal-actions">
                    <button className="btn btn-primary" onClick={handleTokenImport} disabled={importing || addStatus === 'loading'}>
                      <KeyRound size={14} /> {t('accounts.token.importStart')}
                    </button>
                  </div>
                </div>
              )}

              {addTab === 'import' && (
                <div className="add-panel">
                  <div className="import-options">
                    <button className="import-option" onClick={handleImportFromExtension} disabled={importing || addStatus === 'loading'}>
                      <div className="import-option-icon"><Plug size={20} /></div>
                      <div className="import-option-content">
                        <div className="import-option-title">{t('modals.import.fromExtension')}</div>
                        <div className="import-option-desc">{t('modals.import.syncBadge')}</div>
                      </div>
                    </button>

                    <button className="import-option" onClick={handleImportFromLocal} disabled={importing || addStatus === 'loading'}>
                      <div className="import-option-icon"><Database size={20} /></div>
                      <div className="import-option-content">
                        <div className="import-option-title">{t('modals.import.fromLocalDB')}</div>
                        <div className="import-option-desc">{t('modals.import.localDBDesc')}</div>
                      </div>
                    </button>

                    <button className="import-option" onClick={handleImportFromTools} disabled={importing || addStatus === 'loading'}>
                      <div className="import-option-icon"><Rocket size={20} /></div>
                      <div className="import-option-content">
                        <div className="import-option-title">{t('modals.import.tools')}</div>
                        <div className="import-option-desc">{t('modals.import.toolsDescMigrate')}</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {addMessage && (
                <div className={`add-feedback ${addStatus}`}>
                  {addMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('common.confirm')}</h2>
              <button className="modal-close" onClick={() => !deleting && setDeleteConfirm(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p>{deleteConfirm.message}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={confirmDelete} disabled={deleting}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fingerprint Selection Modal */}
      {showFpSelectModal && (
        <div className="modal-overlay" onClick={() => setShowFpSelectModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('modals.fingerprint.title')}</h2>
              <button className="close-btn" onClick={() => setShowFpSelectModal(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>
                <Trans 
                  i18nKey="modals.fingerprint.desc" 
                  values={{ email: accounts.find(a => a.id === showFpSelectModal)?.email }} 
                  components={{ 1: <strong></strong> }}
                />
              </p>
              <div className="form-group">
                <label>{t('modals.fingerprint.selectLabel')}</label>
                <div className="fp-select-list">
                  <label className={`fp-select-item ${selectedFpId === 'original' ? 'selected' : ''}`}>
                    <input 
                      type="radio" 
                      name="fingerprint" 
                      checked={selectedFpId === 'original'} 
                      onChange={() => setSelectedFpId('original')} 
                    />
                    <div className="fp-select-info">
                      <span className="fp-select-item-name">📌 {t('modals.fingerprint.original')}</span>
                      <span className="fp-select-item-id">
                        {t('modals.fingerprint.original')} · {originalFingerprint?.bound_account_count ?? 0} {t('modals.fingerprint.boundCount')}
                      </span>
                    </div>
                  </label>
                  {selectableFingerprints.map(fp => (
                    <label key={fp.id} className={`fp-select-item ${selectedFpId === fp.id ? 'selected' : ''}`}>
                      <input 
                        type="radio" 
                        name="fingerprint" 
                        checked={selectedFpId === fp.id} 
                        onChange={() => setSelectedFpId(fp.id)} 
                      />
                      <div className="fp-select-info">
                        <span className="fp-select-item-name">{fp.name}</span>
                        <span className="fp-select-item-id">{fp.id.substring(0, 8)} · {fp.bound_account_count} {t('modals.fingerprint.boundCount')}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => { setShowFpSelectModal(null); onNavigate?.('fingerprints'); }}>
                   <Plus size={14} /> {t('modals.fingerprint.new')}
                </button>
                <div style={{ flex: 1 }}></div>
                <button className="btn btn-secondary" onClick={() => setShowFpSelectModal(null)}>{t('common.cancel')}</button>
                <button className="btn btn-primary" onClick={handleBindFingerprint}>{t('common.confirm')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quota Details Modal */}
      {showQuotaModal && (() => {
        const account = accounts.find(a => a.id === showQuotaModal);
        if (!account) return null;
        const tier = getSubscriptionTier(account.quota);
        const tierLabel = t(`accounts.tier.${tier.toLowerCase()}`, tier);
        const tierClass = tier === 'PRO' || tier === 'ULTRA' ? 'pill-success' : 'pill-secondary';
        
        return (
          <div className="modal-overlay" onClick={() => setShowQuotaModal(null)}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{t('modals.quota.title')}</h2>
                <div className="badges">
                  {account.quota?.subscription_tier && (
                    <span className={`pill ${tierClass}`}>{tierLabel}</span>
                  )}
                </div>
                <button className="close-btn" onClick={() => setShowQuotaModal(null)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                {account.quota?.models ? (
                  <div className="quota-list">
                    {account.quota.models.map(model => (
                      <div key={model.name} className="quota-card">
                        <h4>{model.name}</h4>
                        <div className="quota-value-row">
                          <span className={`quota-value ${getQuotaClass(model.percentage)}`}>{model.percentage}%</span>
                        </div>
                        <div className="quota-bar">
                          <div 
                            className={`quota-fill ${getQuotaClass(model.percentage)}`} 
                            style={{ width: `${Math.min(100, model.percentage)}%` }}
                          ></div>
                        </div>
                        <div className="quota-reset-info">
                          <p><strong>{t('modals.quota.resetTime')}:</strong> {formatResetTimeDisplay(model.reset_time, t)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state-small">{t('overview.noQuotaData')}</div>
                )}
                
                <div className="modal-actions" style={{ marginTop: 20 }}>
                  <button className="btn btn-secondary" onClick={() => setShowQuotaModal(null)}>{t('common.close')}</button>
                  <button className="btn btn-primary" onClick={() => {
                    handleRefresh(account.id);
                  }}>
                    {refreshing === account.id ? <div className="loading-spinner small" /> : <RefreshCw size={16} />}
                     {t('common.refresh')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* 标签编辑弹窗 */}
      <TagEditModal
        isOpen={!!showTagModal}
        initialTags={accounts.find((acc) => acc.id === showTagModal)?.tags || []}
        availableTags={availableTags}
        onClose={() => setShowTagModal(null)}
        onSave={handleSaveTags}
      />

      {/* 分组管理弹窗 */}
      <GroupSettingsModal
        isOpen={showGroupModal}
        onClose={() => {
          setShowGroupModal(false);
          loadDisplayGroups();
        }}
      />
    </>
  );
}
