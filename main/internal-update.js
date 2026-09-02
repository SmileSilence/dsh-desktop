'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.dshUpdateView = api;
})(typeof window !== 'undefined' ? window : null, () => {
  function formatAppUpdate(result, lang) {
    if (result.errorCode) {
      const messages = {
        RATE_LIMITED: lang.appUpdateRateLimited,
        NO_RELEASE: lang.appUpdateNoRelease,
        INVALID_RESPONSE: lang.appUpdateInvalidResponse,
        INVALID_VERSION: lang.appUpdateInvalidVersion,
        TIMEOUT: lang.appUpdateTimeout,
        NETWORK_ERROR: lang.appUpdateNetworkError
      };
      return { text: messages[result.errorCode] || `${lang.appUpdateFailed}: ${result.error || result.errorCode}`, canOpen: false };
    }
    const current = result.current || lang.versionUnknown;
    const latest = result.latest || lang.versionUnknown;
    return {
      text: result.hasUpdate
        ? `${lang.versionCurrent}: ${current}　${lang.versionLatest}: ${latest}　${lang.appUpdateAvailable}`
        : `${lang.versionCurrent}: ${current}　${lang.versionLatest}: ${latest}　${lang.appUpdateCurrent}`,
      canOpen: result.hasUpdate === true && typeof result.url === 'string' && /^https:\/\/github\.com\//i.test(result.url)
    };
  }

  return { formatAppUpdate };
});
