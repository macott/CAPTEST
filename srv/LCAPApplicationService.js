const cds = require('@sap/cds');
const WorkflowHandler = require('./lib/workflow/WorkflowHandler');
const ExternalServiceHandler = require('./lib/external/ExternalServiceHandler');

class LCAPApplicationService extends cds.ApplicationService {
  /*
   * Overload init() to register own handlers to be invoked first in the respective phase
   * note: before and after handlers are invoked in parallel!
   */
  async init() {
    Object.entries(this.model.definitions).forEach(([name, definition]) => {
      this.dispatchEntityHandler(name, definition);
    });

    // Ensure to call the ApplicationService's init which registers the generic handlers
    super.init();
  }

  async dispatchEntityHandler(name, definition) {
    this.on('READ', name, (data, request) => {
      if (ExternalServiceHandler.isExternalEntity(this, definition)) {
        return ExternalServiceHandler.onEntityReadEvent(this, definition, data, request);
      } else {
        return request();
      }
    });
    this.after('CREATE', name, (data, request) => {
      if (WorkflowHandler.isWorkflowEntity(definition)) {
        WorkflowHandler.afterEntityCreateEvent(definition, data, request);
      }
    });
    this.after('UPDATE', name, (data, request) => {
      if (WorkflowHandler.isWorkflowEntity(definition)) {
        WorkflowHandler.afterEntityUpdateEvent(definition, data, request);
      }
    });
  }
}

module.exports = LCAPApplicationService;
