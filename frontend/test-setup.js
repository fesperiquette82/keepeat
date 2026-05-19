// Mock Expo and React Native modules for node:test environment
import Module from 'module';
const originalResolveFilename = Module.prototype._resolveFilename;

const mocks = {
  'expo-file-system': {
    File: class {
      constructor(path, filename) {
        this.uri = `${path}/${filename}`;
        this.path = path;
        this.filename = filename;
      }
      write(content, options) {
        // No-op in test
      }
      async text() {
        return '';
      }
      delete() {
        // No-op in test
      }
    },
    Paths: {
      document: '/documents',
    },
  },
  'expo-sharing': {
    isAvailableAsync: async () => false,
    shareAsync: async () => {},
  },
  'expo-secure-store': {
    setItemAsync: async () => {},
    getItemAsync: async () => null,
    deleteItemAsync: async () => {},
  },
  'react-native': {
    Platform: {
      OS: 'web',
    },
  },
};

Module.prototype._resolveFilename = function (request, parent, isMain) {
  if (mocks[request]) {
    return request;
  }
  return originalResolveFilename.call(this, request, parent, isMain);
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (mocks[id]) {
    return mocks[id];
  }
  return originalRequire.call(this, id);
};
