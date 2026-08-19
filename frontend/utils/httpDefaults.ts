import axios from 'axios';

/**
 * Timeout par défaut pour tous les appels axios de l'app (15 s) — aucun n'en
 * avait, ce qui pouvait laisser un écran de chargement indéfiniment si le
 * backend était lent ou indisponible.
 *
 * Fixé sur `axios.defaults` (le singleton partagé par tous les modules qui
 * importent 'axios') plutôt que via une instance séparée (`axios.create()`) :
 * store/stockStore.ts enregistre un intercepteur directement sur ce singleton
 * (`axios.interceptors.response.use(...)`) et store/appSettingsStore.ts utilise
 * l'utilitaire statique `axios.isAxiosError` — une instance séparée n'aurait
 * hérité ni de l'un ni de l'autre.
 *
 * Ce fichier doit être importé une fois, le plus tôt possible (app/_layout.tsx),
 * avant le premier appel réseau.
 */
axios.defaults.timeout = 15000;
