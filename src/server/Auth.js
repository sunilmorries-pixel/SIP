/**
 * Auth.js — service-account OAuth for BigQuery.
 * Requires the OAuth2 library (see appsscript.json dependencies) and the
 * SA key stored in Script Properties under CONFIG.SA_PROPERTY_KEY.
 */

/**
 * Returns an authorized OAuth2 service for BigQuery (read-only).
 * @return {OAuth2.Service}
 */
function getBigQueryService() {
  var raw = PropertiesService.getScriptProperties().getProperty(CONFIG.SA_PROPERTY_KEY);
  if (!raw) {
    throw new Error(
      'Service-account key not found in Script Properties ("' + CONFIG.SA_PROPERTY_KEY + '"). ' +
      'Run setupServiceAccountKey() once — see server/Setup.js.'
    );
  }
  var key = JSON.parse(raw);
  return OAuth2.createService('BigQuery-SA')
    .setTokenUrl(key.token_uri || 'https://oauth2.googleapis.com/token')
    .setPrivateKey(key.private_key)
    .setIssuer(key.client_email)
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setCache(CacheService.getScriptCache())
    .setLock(LockService.getScriptLock())
    .setScope(CONFIG.BQ_SCOPE);
}

/**
 * Returns a bearer token, throwing a readable error if auth fails.
 * @return {string}
 */
function getBigQueryAccessToken() {
  var service = getBigQueryService();
  if (!service.hasAccess()) {
    throw new Error('BigQuery auth failed: ' + service.getLastError());
  }
  return service.getAccessToken();
}
