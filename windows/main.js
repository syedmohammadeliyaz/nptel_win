'use strict';
const { app, dialog } = require('electron');

function fatal(title, e) {
  try { dialog.showErrorBox(title, String((e && e.stack) || e)); } catch (x) { /* nothing more to try */ }
  app.exit(1);
}
process.on('uncaughtException', function (e) { fatal('NPTEL Library', e); });
require('./lib/app').start().catch(function (e) { fatal('NPTEL Library could not start', e); });
