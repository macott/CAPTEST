const MashupHandler = require('./handle-mashups');

class ExternalServiceHandler {
  static isExternalEntity(service, definition) {
    const mashupHandler = new MashupHandler(service);
    const mashupServices = mashupHandler.getTargetServiceNames(definition);
    return mashupServices.length > 0;
  }

  static async onEntityReadEvent(service, definition, data, request) {
    const mashupHandler = new MashupHandler(service);
    const success = await mashupHandler.init(definition);
    if (success) {
      return mashupHandler.handle(data, request);
    } else {
      return request();
    }
  }
}

module.exports = ExternalServiceHandler;
