// BUG-099 : résolution des modules pour le bundle web.
//
// Sur le web, Metro suit la condition « import » des paquets et embarque les
// fichiers ESM de zustand. `zustand/middleware` y lit `import.meta.env`. Or le
// bundle web d'Expo est chargé comme un script classique : `import.meta` y
// est une erreur de syntaxe, le navigateur rejette le bundle entier et
// l'application web ne démarre pas (la page reste une coquille inerte).
//
// On force donc, pour le web seulement, les fichiers CommonJS de ces paquets :
// ceux que l'application Android utilise déjà (condition « react-native »).
// Aucune autre plateforme ni aucun autre paquet n'est concerné.

const WEB_COMMONJS_PACKAGES = ['zustand'];

function isForcedToCommonJs(moduleName) {
  return WEB_COMMONJS_PACKAGES.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
}

/**
 * @param {Function | undefined} upstreamResolveRequest résolveur déjà configuré, s'il y en a un
 * @param {(moduleName: string) => string} resolveCommonJsFile résolution Node (condition « require »)
 */
function createWebSafeResolveRequest(upstreamResolveRequest, resolveCommonJsFile = require.resolve) {
  return function resolveRequest(context, moduleName, platform) {
    if (platform === 'web' && isForcedToCommonJs(moduleName)) {
      return { type: 'sourceFile', filePath: resolveCommonJsFile(moduleName) };
    }
    const next = upstreamResolveRequest || context.resolveRequest;
    return next(context, moduleName, platform);
  };
}

module.exports = { createWebSafeResolveRequest, WEB_COMMONJS_PACKAGES };
