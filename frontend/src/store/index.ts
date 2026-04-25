import { create } from 'zustand';
import { Account, Transaction } from '../types';
import { getAccounts, getTransactions, triggerBackgroundSync } from '../services/api';

const ACCOUNTS_CACHE_KEY = 'mm_accounts_cache_v1';
const TRANSACTIONS_CACHE_KEY = 'mm_transactions_cache_v1';
const LAST_SYNC_KEY = 'mm_last_sync_v1';

const readCache = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeCache = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

interface Store {
  accounts: Account[];
  transactions: Transaction[];
  selectedMonth: Date;
  viewMode: 'personal' | 'business';
  theme: 'light' | 'dark';
  isLoading: boolean;
  lastSyncedAt: string | null;
  loadAccounts: () => Promise<void>;
  loadTransactions: () => Promise<void>;
  setSelectedMonth: (month: Date) => void;
  setViewMode: (mode: 'personal' | 'business') => void;
  setTheme: (t: 'light' | 'dark') => void;
}

export const useStore = create<Store>((set) => ({
  accounts: readCache<Account[]>(ACCOUNTS_CACHE_KEY, []),
  transactions: readCache<any[]>(TRANSACTIONS_CACHE_KEY, []).map((t: any) => ({
    ...t,
    transactionDate: t.transactionDate ? new Date(t.transactionDate) : new Date()
  })),
  selectedMonth: new Date(),
  viewMode: 'personal',
  theme: (localStorage.getItem('app_theme') as 'light' | 'dark') || 'light',
  isLoading: false,
  lastSyncedAt: readCache<string | null>(LAST_SYNC_KEY, null),
  loadAccounts: async () => {
    set({ isLoading: true });
    try {
      // Trigger background sync - non-blocking, fires in background
      triggerBackgroundSync().catch(err => 
        console.warn('[Store] Background sync request failed (non-critical):', err)
      );
      
      const accounts = await getAccounts();
      console.log('[Store] loadAccounts success:', accounts);
      const syncedAt = new Date().toISOString();
      writeCache(ACCOUNTS_CACHE_KEY, accounts);
      writeCache(LAST_SYNC_KEY, syncedAt);
      set({ accounts, isLoading: false, lastSyncedAt: syncedAt });
    } catch (err) {
      console.error('[Store] loadAccounts failed', err);
      set({ isLoading: false });
    }
  },
  loadTransactions: async () => {
    try {
      const transactions = await getTransactions();
      console.log('[Store] loadTransactions success:', transactions.length, 'transactions');
      writeCache(TRANSACTIONS_CACHE_KEY, transactions);
      set({ transactions });
    } catch (err) {
      console.error('[Store] loadTransactions failed', err);
    }
  },
  setSelectedMonth: (month: Date) => {
    set({ selectedMonth: month });
  },
  setViewMode: (mode: 'personal' | 'business') => {
    set({ viewMode: mode });
  }
  ,
  setTheme: (t: 'light' | 'dark') => {
    set({ theme: t });
    try { localStorage.setItem('app_theme', t); } catch (e) {}
  }
}));
