import { create } from 'zustand';
import type { PremiumErrorDetail } from '../utils/premiumErrors';

interface PremiumUiState {
  isOpen: boolean;
  context: PremiumErrorDetail | null;
  openPaywall: (context: PremiumErrorDetail) => void;
  closePaywall: () => void;
}

export const usePremiumUiStore = create<PremiumUiState>((set) => ({
  isOpen: false,
  context: null,
  openPaywall: (context) => set({ isOpen: true, context }),
  closePaywall: () => set({ isOpen: false, context: null }),
}));
