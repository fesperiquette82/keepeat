import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Language = 'fr' | 'en';

interface Translations {
  [key: string]: { fr: string; en: string };
}

const translations: Translations = {
  // Home
  subtitle: { fr: 'Vos aliments, au bon moment', en: 'Your food, at the right time' },
  inStock: { fr: 'En stock', en: 'In stock' },
  expiringSoon: { fr: 'Bientôt périmé', en: 'Expiring soon' },
  expired: { fr: 'Périmé', en: 'Expired' },
  consumeFirst: { fr: 'À consommer en priorité', en: 'Consume first' },
  myStock: { fr: 'Mon stock', en: 'My stock' },
  emptyStock: { fr: 'Votre stock est vide', en: 'Your stock is empty' },
  scanToAdd: { fr: 'Scannez un produit pour commencer', en: 'Scan a product to start' },
  noDate: { fr: 'Sans date', en: 'No date' },
  today: { fr: "Aujourd'hui", en: 'Today' },
  daysLeft: { fr: 'j restants', en: 'd left' },

  // Actions
  markConsumed: { fr: 'Consommé', en: 'Consumed' },
  markThrown: { fr: 'Jeté', en: 'Thrown away' },
  confirmConsume: { fr: 'Marquer {name} comme consommé ?', en: 'Mark {name} as consumed?' },
  confirmThrow: { fr: 'Marquer {name} comme jeté ?', en: 'Mark {name} as thrown away?' },
  cancel: { fr: 'Annuler', en: 'Cancel' },
  confirm: { fr: 'Confirmer', en: 'Confirm' },
  delete: { fr: 'Supprimer', en: 'Delete' },

  // Scanner
  scanTitle: { fr: 'Scanner un produit', en: 'Scan a product' },
  scanInstructions: { fr: 'Placez le code-barres dans le cadre', en: 'Place the barcode in the frame' },
  cameraPermission: { fr: 'Autoriser la caméra', en: 'Allow camera' },
  cameraPermissionText: {
    fr: "L'accès à la caméra est nécessaire pour scanner les codes-barres",
    en: 'Camera access is needed to scan barcodes',
  },
  manualEntry: { fr: 'Saisie manuelle', en: 'Manual entry' },
  searching: { fr: 'Recherche...', en: 'Searching...' },

  // Add Product
  addProduct: { fr: 'Ajouter un produit', en: 'Add a product' },
  productName: { fr: 'Nom du produit', en: 'Product name' },
  brand: { fr: 'Marque', en: 'Brand' },
  quantity: { fr: 'Quantité', en: 'Quantity' },
  expiryDate: { fr: 'Date de péremption', en: 'Expiry date' },
  save: { fr: 'Enregistrer', en: 'Save' },
  productAdded: { fr: 'Produit ajouté', en: 'Product added' },
  selectDate: { fr: 'Sélectionner une date', en: 'Select a date' },
  editProduct: { fr: 'Modifier le produit', en: 'Edit product' },
  deleteProduct: { fr: 'Supprimer le produit', en: 'Delete product' },
  confirmDelete: { fr: 'Supprimer {name} ?', en: 'Delete {name}?' },

  // Settings
  settings: { fr: 'Réglages', en: 'Settings' },
  language: { fr: 'Langue', en: 'Language' },
  statistics: { fr: 'Statistiques', en: 'Statistics' },
  totalItems: { fr: 'Total en stock', en: 'Total in stock' },
  consumedWeek: { fr: 'Consommés cette semaine', en: 'Consumed this week' },
  thrownWeek: { fr: 'Jetés cette semaine', en: 'Thrown away this week' },

  // Mentionnée dans index.tsx
  addManually: { fr: 'Ajouter', en: 'Add' },
};

interface LanguageStore {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: string) => string;
  loadLanguage: () => Promise<void>;
}

export const useLanguageStore = create<LanguageStore>((set, get) => ({
  language: 'fr',

  setLanguage: async (lang: Language) => {
    set({ language: lang });
    await AsyncStorage.setItem('keepeat_language', lang);
  },

  t: (key: string) => {
    const { language } = get();
    return translations[key]?.[language] || key;
  },

  loadLanguage: async () => {
    try {
      const savedLang = await AsyncStorage.getItem('keepeat_language');
      if (savedLang && (savedLang === 'fr' || savedLang === 'en')) {
        set({ language: savedLang });
      }
    } catch (error) {
      console.error('Error loading language:', error);
    }
  },
}));
