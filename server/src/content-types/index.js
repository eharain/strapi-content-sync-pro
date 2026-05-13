'use strict';

const syncLogSchema = require('./sync-log/schema.json');
const syncRunReportSchema = require('./sync-run-report/schema.json');
const workflowNotificationSchema = require('./workflow-notification/schema.json');

module.exports = {
  'sync-log': { schema: syncLogSchema },
  'sync-run-report': { schema: syncRunReportSchema },
  'workflow-notification': { schema: workflowNotificationSchema },
};
