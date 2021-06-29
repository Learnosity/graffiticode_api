const DEBUG =
      process.env.DEBUG_GRAFFITICODE === 'true' ||
      process.env.LOCAL_COMPILES === 'true' ||
      false;

export function buildGetAsset({ getBaseUrlForLanguage, bent }) {
  const cache = new Map();
  return async function getAsset(lang, path) {
    const key = `${lang}.${path}`;
    try {
      if (DEBUG || !cache.has(key)) {
        const baseUrl = getBaseUrlForLanguage(lang);
        const getLanguageAsset = bent(baseUrl, 'string');
        cache.set(key, getLanguageAsset(path));
      }
      return await cache.get(key);
    } catch (err) {
      cache.delete(key);
      throw err;
    }
  };
}
