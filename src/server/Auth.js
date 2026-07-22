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
  // Renamed from 'BigQuery-SA' during the 2026-07-22 tricogde-dwh migration: a
  // different service name guarantees a fresh OAuth2 token cache, so no stale
  // token issued for the old magnaquest-sand-box service account can be reused.
  return OAuth2.createService('BigQuery-DWH-SA')
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

/**
 * Application-level access control.
 *
 * appsscript.json restricts the web app to the tricog.com DOMAIN, but every
 * endpoint runs as the DEPLOYING user's service account — so any domain user
 * would otherwise read the full fleet/customer/ticket data. This narrows that
 * to an explicit allowlist.
 *
 * The allowlist is the AUTHORIZED_EMAILS Script Property: a comma/space/newline
 * separated list of emails. ROLLOUT-SAFE: if the property is UNSET, the guard
 * allows everyone (preserving today's behaviour) and logs a warning, so pushing
 * this code never locks anyone out. Enforcement begins the moment you set the
 * property. Set it in Project Settings → Script Properties, e.g.
 *   AUTHORIZED_EMAILS = abi@tricog.com, sunil.morries@tricog.com
 *
 * @return {Array<string>} lowercased allowlist ([] when unconfigured)
 */
function getAuthorizedEmails_() {
  var raw = PropertiesService.getScriptProperties().getProperty('AUTHORIZED_EMAILS') || '';
  return raw.split(/[\s,;]+/)
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return e.length > 0; });
}

/**
 * Throws if the current caller is not on the allowlist. No-op (with a warning)
 * while AUTHORIZED_EMAILS is unconfigured. Call at every trust boundary
 * (respond_, doGet).
 */
function assertAuthorized_() {
  var allow = getAuthorizedEmails_();
  if (!allow.length) {
    console.warn('AUTHORIZED_EMAILS is not set — access control is OPEN to the whole domain. ' +
      'Set the Script Property to enforce an allowlist.');
    return;
  }
  var user = '';
  try { user = (Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { user = ''; }
  if (!user || allow.indexOf(user) === -1) {
    throw new Error('Not authorized');
  }
}
