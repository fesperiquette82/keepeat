import { create } from 'zustand';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface StockItem {
  id: string;
  barcode?: string;
  name: string;
  brand?: string;
  image_url?: string;
  category?: string;
  quantity?: string;
  expiry_date?: string;
  added_date: string;
  status: string;
  notes?: string;
}

export interface ProductInfo {
  barcode?: string;
  name: string;
  brand?: string;
  image_url?: string;
  category?: string;
  quantity?: string;
}

export interface ShelfLife {
  category: string;
  category_fr: string;
  refrigerator_days?: number;
  freezer_days?: number;
  pantry_days?: number;
  after_opening_days?: number;
  tips?: string;
  tips_fr?: string;
}

export interface Stats {
  total_items: number;
  expiring_soon: number;
  expired: number;
  consumed_this_week: number;
  thrown_this_week: number;
}

interface StockStore {
  items: StockItem[];
  priorityItems: StockItem[];
  stats: Stats;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchStock: () => Promise<void>;
  fetchPriorityItems: () => Promise<void>;
  fetchStats: () => Promise<void>;
  addItem: (item: Partial<StockItem>) => Promise<StockItem | null>;
  updateItem: (id: string, updates: Partial<StockItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  markConsumed: (id: string) => Promise<void>;
  markThrown: (id: string) => Promise<void>;
  lookupProduct: (barcode: string) => Promise<ProductInfo | null>;
}

export const useStockStore = create<StockStore>((set, get) => ({
  items: [],
  priorityItems: [],
  stats: {
    total_items: 0,
    expiring_soon: 0,
    expired: 0,
    consumed_this_week: 0,
    thrown_this_week: 0,
  },
  isLoading: false,
  error: null,

  fetchStock: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await axios.get(`${API_URL}/api/stock?status=active`);
      set({ items: response.data, isLoading: false });
    } catch (error: any) {
      console.error('Error fetching stock:', error);
      set({ error: error.message, isLoading: false });
    }
  },

  fetchPriorityItems: async () => {
    try {
      const response = await axios.get(`${API_URL}/api/stock/priority`);
      set({ priorityItems: response.data });
    } catch (error: any) {
      console.error('Error fetching priority items:', error);
    }
  },

  fetchStats: async () => {
    try {
      const response = await axios.get(`${API_URL}/api/stats`);
      set({ stats: response.data });
    } catch (error: any) {
      console.error('Error fetching stats:', error);
    }
  },

  addItem: async (item) => {
    try {
      const response = await axios.post(`${API_URL}/api/stock`, item);
      const newItem = response.data;
      set((state) => ({ items: [...state.items, newItem] }));
      return newItem;
    } catch (error: any) {
      console.error('Error adding item:', error);
      set({ error: error.message });
      return null;
    }
  },

  updateItem: async (id, updates) => {
    try {
      await axios.put(`${API_URL}/api/stock/${id}`, updates);
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id ? { ...item, ...updates } : item
        ),
      }));
    } catch (error: any) {
      console.error('Error updating item:', error);
      set({ error: error.message });
    }
  },

  deleteItem: async (id) => {
    try {
      await axios.delete(`${API_URL}/api/stock/${id}`);
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
    } catch (error: any) {
      console.error('Error deleting item:', error);
      set({ error: error.message });
    }
  },

  markConsumed: async (id) => {
    try {
      await axios.post(`${API_URL}/api/stock/${id}/consume`);
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
        priorityItems: state.priorityItems.filter((item) => item.id !== id),
      }));
    } catch (error: any) {
      console.error('Error marking consumed:', error);
      set({ error: error.message });
    }
  },

  markThrown: async (id) => {
    try {
      await axios.post(`${API_URL}/api/stock/${id}/throw`);
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
        priorityItems: state.priorityItems.filter((item) => item.id !== id),
      }));
    } catch (error: any) {
      console.error('Error marking thrown:', error);
      set({ error: error.message });
    }
  },

  lookupProduct: async (barcode) => {
    try {
      const response = await axios.get(`${API_URL}/api/product/${barcode}`);
      if (response.data.found) {
        return {
          product: response.data.product,
          shelfLife: response.data.shelf_life
        };
      }
      return { product: null, shelfLife: response.data.shelf_life };
    } catch (error: any) {
      console.error('Error looking up product:', error);
      return null;
    }
  },

  getShelfLife: async (query: string) => {
    try {
      const response = await axios.get(`${API_URL}/api/shelf-life/${encodeURIComponent(query)}`);
      return response.data.shelf_life;
    } catch (error: any) {
      console.error('Error getting shelf life:', error);
      return null;
    }
  },

  // Community shelf life contributions
  contributeCommunityShelfLife: async (data: {
    product_name: string;
    barcode?: string;
    category?: string;
    shelf_life_days: number;
    storage_type: string;
    source: string;
  }) => {
    try {
      const response = await axios.post(`${API_URL}/api/community-shelf-life`, data);
      return response.data;
    } catch (error: any) {
      console.error('Error contributing shelf life:', error);
      return null;
    }
  },

  getCommunityShelfLife: async (query: string) => {
    try {
      const response = await axios.get(`${API_URL}/api/community-shelf-life/${encodeURIComponent(query)}`);
      return response.data.results;
    } catch (error: any) {
      console.error('Error getting community shelf life:', error);
      return [];
    }
  },
}));
