// Imports conditionnels (même motif que debugSwipeLogger.ts) : expo-file-system et
// expo-sharing n'existent pas dans l'environnement Node des tests (`node --test`).

interface FileInterface {
  uri: string;
  write(content: string, options?: any): void;
}

interface FilesystemPaths {
  document: string;
}

interface SharingInterface {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(uri: string, options: any): Promise<void>;
}

class FallbackFile implements FileInterface {
  uri = '';
  write(_content: string, _options?: any) {}
}

let File: new (path: string, filename: string) => FileInterface;
let Paths: FilesystemPaths;
let Sharing: SharingInterface;

try {
  const expoFS = require('expo-file-system');
  File = expoFS.File;
  Paths = expoFS.Paths;
} catch {
  File = FallbackFile as any;
  Paths = { document: '/documents' };
}

try {
  Sharing = require('expo-sharing');
} catch {
  Sharing = {
    isAvailableAsync: async () => false,
    shareAsync: async () => {},
  };
}

export function buildAccountExportFilename(now: Date = new Date()): string {
  return `keepeat-export-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Écrit l'export de compte dans un fichier JSON local puis ouvre la feuille de
 * partage native pour que l'utilisateur puisse l'enregistrer où il le souhaite.
 * Retourne false si le partage n'est pas disponible sur l'appareil (le fichier
 * est tout de même écrit sur le disque local).
 */
export async function saveAndShareAccountExport(payload: unknown): Promise<boolean> {
  const filename = buildAccountExportFilename();
  const file = new File(Paths.document, filename);
  file.write(JSON.stringify(payload, null, 2));

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) return false;

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Exporter mes données KeepEat',
    UTI: 'public.json',
  });
  return true;
}
