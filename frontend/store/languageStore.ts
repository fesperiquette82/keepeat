import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

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
  barcodePlaceholder: { fr: 'Code-barres (EAN)', en: 'Barcode (EAN)' },
  scanner: { fr: 'Scanner', en: 'Scan' },
  ticket: { fr: 'Ticket', en: 'Receipt' },
  rescan: { fr: 'Rescanner', en: 'Rescan' },
  gallery: { fr: 'Galerie', en: 'Gallery' },
  importPhoto: { fr: 'Importer une photo', en: 'Import photo' },
  galleryPermissionRequired: {
    fr: "Autorisez l'accès à la galerie pour importer une photo.",
    en: 'Allow photo library access to import an image.',
  },
  galleryUnavailable: {
    fr: "L'import galerie n'est pas prêt dans ce build. Recompilez l'application après installation de expo-image-picker.",
    en: 'Gallery import is not available in this build. Rebuild the app after installing expo-image-picker.',
  },
  invalidImage: { fr: 'Image invalide ou non exploitable.', en: 'Invalid or unusable image.' },
  barcodeNotDetected: { fr: 'Aucun code-barres détecté sur cette image.', en: 'No barcode detected in this image.' },
  scanFailed: { fr: 'Analyse impossible. Réessayez avec une autre image.', en: 'Could not analyse. Try another image.' },
  searchProductLoading: { fr: 'Recherche du produit...', en: 'Looking up product...' },

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

  // Settings / misc labels used in multiple screens
  french: { fr: 'Français', en: 'French' },
  english: { fr: 'Anglais', en: 'English' },
  consumedThisWeek: { fr: 'Consommés cette semaine', en: 'Consumed this week' },
  thrownThisWeek: { fr: 'Jetés cette semaine', en: 'Thrown away this week' },
  about: { fr: 'À propos', en: 'About' },
  version: { fr: 'Version', en: 'Version' },
  name: { fr: 'Nom', en: 'Name' },
  notes: { fr: 'Notes', en: 'Notes' },
  apply: { fr: 'Appliquer', en: 'Apply' },
  productFound: { fr: 'Produit trouvé', en: 'Product found' },
  productNotFound: { fr: 'Produit introuvable', en: 'Product not found' },
  scannedProductFallback: { fr: 'Produit scanné', en: 'Scanned product' },
  errorTitle: { fr: 'Erreur', en: 'Error' },
  productNameRequired: { fr: 'Le nom du produit est requis', en: 'Product name is required' },
  invalidDuration: { fr: 'Merci de saisir un nombre de jours supérieur à 0', en: 'Please enter a number of days greater than 0' },
  addProductError: { fr: "Impossible d'ajouter le produit", en: 'Unable to add product' },
  updateProductSuccessTitle: { fr: 'Modifié !', en: 'Updated!' },
  updateProductError: { fr: 'Impossible de modifier le produit', en: 'Unable to update product' },
  exampleProductName: { fr: 'Ex: Lait demi-écrémé', en: 'Ex: Semi-skimmed milk' },
  exampleBrand: { fr: 'Ex: Lactel', en: 'Ex: Brand name' },
  exampleQuantity: { fr: 'Ex: 1L, 500g', en: 'Ex: 1L, 500g' },
  dateModeAuto: { fr: 'Auto', en: 'Auto' },
  dateModeDuration: { fr: 'Durée', en: 'Duration' },
  dateModeDate: { fr: 'Date', en: 'Date' },
  dateModeScan: { fr: 'Scanner', en: 'Scan' },
  categoryLabel: { fr: 'Catégorie: {name}', en: 'Category: {name}' },
  durationPlaceholder: { fr: 'Nombre de jours', en: 'Number of days' },
  chooseDate: { fr: 'Choisir une date', en: 'Choose a date' },
  openOcrScanner: { fr: 'Ouvrir le scanner OCR', en: 'Open OCR scanner' },
  additionalNotesPlaceholder: { fr: 'Infos complémentaires...', en: 'Additional notes...' },
  optionalNotesPlaceholder: { fr: 'Notes optionnelles...', en: 'Optional notes...' },
  quickAddNoDate: { fr: 'Ajouter rapidement (sans date)', en: 'Quick add (no date)' },
  suggestionRefrigerator: { fr: 'Réfrigérateur ({days}j)', en: 'Refrigerator ({days}d)' },
  suggestionPantry: { fr: 'Placard ({days}j)', en: 'Pantry ({days}d)' },
  suggestionFreezer: { fr: 'Congélateur ({days}j)', en: 'Freezer ({days}d)' },
  recipesFilterAll: { fr: 'Toutes', en: 'All' },
  recipesFilterExpiryDay: { fr: 'Ce jour', en: 'Today' },
  recipesFilterExpiryWeek: { fr: 'Cette semaine', en: 'This week' },
  recipesFilterExpiryMonth: { fr: 'Ce mois', en: 'This month' },
  recipesEmptyAll: { fr: 'Aucune suggestion liée à votre stock actuel.', en: 'No suggestions linked to your current stock.' },
  recipesEmptyExpiryDay: { fr: 'Aucun produit à consommer aujourd’hui.', en: 'No products to consume today.' },
  recipesEmptyExpiryWeek: { fr: 'Aucun produit à consommer cette semaine.', en: 'No products to consume this week.' },
  recipesEmptyExpiryMonth: { fr: 'Aucun produit à consommer ce mois.', en: 'No products to consume this month.' },

  // Mentionnée dans index.tsx
  addManually: { fr: 'Ajouter', en: 'Add' },

  // Date picker / OCR camera modal
  invalidDate: { fr: 'Date invalide', en: 'Invalid date' },
  day: { fr: 'Jour', en: 'Day' },
  month: { fr: 'Mois', en: 'Month' },
  year: { fr: 'Année', en: 'Year' },
  scanDate: { fr: 'Scanner la date', en: 'Scan date' },
  placeDateHere: { fr: 'Placez la date ici', en: 'Place date here' },
  cameraPermissionRequired: { fr: 'Autorisation caméra requise', en: 'Camera permission required' },
  allow: { fr: 'Autoriser', en: 'Allow' },
  captureAndScan: { fr: 'Capturer & analyser', en: 'Capture & scan' },
  enterDateOnPackaging: { fr: "Saisissez la date vue sur l'emballage :", en: 'Enter the date seen on packaging:' },
  dateInputExample: { fr: 'Ex: 15/03/2025, 15 mars 25, mars 2025...', en: 'Ex: 15/03/2025, 15 Mar 25, March 2025...' },
  detectedFormat: { fr: 'Format détecté: ', en: 'Detected format: ' },
  unrecognizedFormat: { fr: 'Format non reconnu', en: 'Unrecognized format' },
  acceptedFormats: { fr: 'Formats acceptés :', en: 'Accepted formats:' },

  // Settings
  settingsTitle: { fr: 'Paramètres', en: 'Settings' },
  themeSection: { fr: 'Thème', en: 'Theme' },
  themeLight: { fr: 'Clair', en: 'Light' },
  themeDark: { fr: 'Sombre', en: 'Dark' },
  languageSection: { fr: 'Langue', en: 'Language' },
  householdSize: { fr: 'Nombre de convives par défaut', en: 'Default number of diners' },
  peopleCount: { fr: '{count} personnes', en: '{count} people' },
  defaultRecipeHint: { fr: 'Valeur par défaut utilisée pour les recettes.', en: 'Default value used for recipes.' },
  productReminders: { fr: 'Rappels produits', en: 'Product reminders' },
  reminderLeadTime: { fr: 'Délai avant péremption', en: 'Lead time before expiry' },
  notUpdatedYet: { fr: 'Pas encore mis à jour', en: 'Not updated yet' },
  remindersLastUpdate: { fr: 'Dernière mise à jour des rappels : {date}', en: 'Last reminder update: {date}' },
  updateInProgress: { fr: 'Mise à jour…', en: 'Updating…' },
  updateNow: { fr: 'Mettre à jour maintenant', en: 'Update now' },
  remindersUpdatedSuccess: { fr: 'Produits rappelés mis à jour avec succès.', en: 'Reminder products updated successfully.' },
  premium: { fr: 'Premium', en: 'Premium' },
  currentPlan: { fr: 'Plan actuel : {plan}', en: 'Current plan: {plan}' },
  currentPlanPremium: { fr: 'Plan actuel : Premium', en: 'Current plan: Premium' },
  premiumStatusActive: { fr: 'Statut : actif', en: 'Status: active' },
  premiumStatusLoading: { fr: 'Chargement du statut Premium…', en: 'Loading premium status…' },
  premiumRenewsOn: { fr: 'Renouvellement le', en: 'Renews on' },
  premiumExpiresOn: { fr: 'Expire le', en: 'Expires on' },
  upgradePremium: { fr: 'Passer Premium', en: 'Go Premium' },
  restoreTitle: { fr: 'Restauration', en: 'Restore' },
  restoreSuccess: { fr: 'Vos droits premium ont été synchronisés.', en: 'Your premium access has been synced.' },
  restorePurchases: { fr: 'Restaurer mes achats', en: 'Restore purchases' },
  restoreError: { fr: 'Impossible de restaurer les achats.', en: 'Unable to restore purchases.' },
  accountSection: { fr: 'Compte', en: 'Account' },
  logoutButton: { fr: 'Déconnection', en: 'Log out' },
  logoutConfirmTitle: { fr: 'Déconnexion', en: 'Log out' },
  logoutConfirmMessage: { fr: 'Voulez-vous vraiment vous déconnecter ?', en: 'Do you really want to log out?' },
  logoutErrorMessage: { fr: 'Impossible de vous déconnecter pour le moment.', en: 'Unable to log you out right now.' },
  exportDataButton: { fr: 'Exporter mes données', en: 'Export my data' },
  exportDataHint: {
    fr: 'Téléchargez une copie de vos données personnelles (profil, stock, tickets de caisse).',
    en: 'Download a copy of your personal data (profile, stock, receipt tickets).',
  },
  exportDataSuccess: { fr: 'Export généré', en: 'Export generated' },
  exportDataError: { fr: "Impossible d'exporter vos données pour le moment.", en: 'Unable to export your data right now.' },
  exportDataUnavailable: {
    fr: 'Le partage de fichiers n’est pas disponible sur cet appareil.',
    en: 'File sharing is not available on this device.',
  },
  deleteAccountButton: { fr: 'Supprimer mon compte', en: 'Delete my account' },
  privacyPolicyButton: { fr: 'Politique de confidentialité', en: 'Privacy policy' },
  adminSection: { fr: 'Administration', en: 'Administration' },
  adminMonitoringAccess: { fr: 'Accès monitoring backend (admin only).', en: 'Backend monitoring access (admin only).' },
  openMonitoringBackoffice: { fr: 'Ouvrir le back-office monitoring', en: 'Open monitoring back-office' },
};

interface LanguageStore {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  loadLanguage: () => Promise<void>;
}

export const useLanguageStore = create<LanguageStore>((set, get) => ({
  language: 'fr',

  setLanguage: async (lang: Language) => {
    set({ language: lang });
    await AsyncStorage.setItem('keepeat_language', lang);
  },

  t: (key: string, params) => {
    const { language } = get();
    const template = translations[key]?.[language] || key;
    if (!params) return template;
    return Object.entries(params).reduce(
      (acc, [paramKey, value]) => acc.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value)),
      template,
    );
  },

  loadLanguage: async () => {
    try {
      const savedLang = await AsyncStorage.getItem('keepeat_language');
      if (savedLang && (savedLang === 'fr' || savedLang === 'en')) {
        set({ language: savedLang });
      }
    } catch (error) {
      logger.error('Error loading language', { message: error instanceof Error ? error.message : String(error) });
    }
  },
}));
