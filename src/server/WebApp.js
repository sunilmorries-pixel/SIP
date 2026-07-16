/**
 * WebApp.js — HTTP entry point and HTML templating helpers.
 */

/**
 * Serves the dashboard.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  try {
    assertAuthorized_();
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<div style="font:16px/1.5 system-ui,sans-serif;padding:48px;max-width:520px;margin:0 auto;color:#333">' +
      '<h2>Access restricted</h2>' +
      '<p>Your account isn’t authorized to view this dashboard. ' +
      'Contact the dashboard owner to request access.</p></div>'
    ).setTitle('Access restricted');
  }
  var template = htmlTemplate_('Index');
  template.appName = CONFIG.APP_NAME;
  template.appVersion = CONFIG.APP_VERSION;
  return template.evaluate()
    .setTitle(CONFIG.APP_NAME + ' — Device Fleet Intelligence')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Includes a client partial inside a template:  <?!= include('Styles') ?>
 * Resolves both clasp-pushed nested names ("client/Styles") and flat names
 * ("Styles") so the project works whether it was pushed with clasp or the
 * files were pasted into the editor by hand.
 * @param {string} filename
 * @return {string}
 */
function include(filename) {
  return htmlTemplate_(filename).evaluate().getContent();
}

/**
 * @param {string} filename base name without extension
 * @return {GoogleAppsScript.HTML.HtmlTemplate}
 */
function htmlTemplate_(filename) {
  try {
    return HtmlService.createTemplateFromFile('client/' + filename);
  } catch (err) {
    return HtmlService.createTemplateFromFile(filename);
  }
}
