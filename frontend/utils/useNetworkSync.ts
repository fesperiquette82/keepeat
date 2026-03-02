import { useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useStockStore } from '../store/stockStore';

/**
 * Hook à monter dans le layout racine.
 * Écoute les changements de connectivité et déclenche la sync du store.
 */
export function useNetworkSync(): void {
  const setOnline = useStockStore(state => state.setOnline);

  useEffect(() => {
    // Vérification initiale
    NetInfo.fetch().then(state => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setOnline(online);
    });

    // Écoute continue
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setOnline(online);
    });

    return () => unsubscribe();
  }, [setOnline]);
}
