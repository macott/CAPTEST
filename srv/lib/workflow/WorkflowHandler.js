const xsenv = require('@sap/xsenv');
const xssec = require('@sap/xssec');
const axios = require("axios");

const DEFINITION_ID_ANNOTATION = '@workflow.start.definitionId';
const START_DATAOBJECT_ANNOTATION = '@workflow.start.dataObject';
const START_PROPERTY_ANNOTATION = '@workflow.start.property';
const CAP_ENTITY_KEY_NAME = 'capEntityKeyObject';
const TASK_ENABLED_ASPECT = 'sap.workflow.TaskEnabled';

class WorkflowHandler {
  static isWorkflowEntity(definition) {
    return definition && definition.kind === 'entity' &&
      _getAnnotatedValue(definition, DEFINITION_ID_ANNOTATION);
  }

  static async afterEntityCreateEvent(definition, data, request) {
    const workflowEntityHandler = new WorkflowEntityHandler(definition);
    workflowEntityHandler.afterEntityCreate(data, request);
  }

  static async afterEntityUpdateEvent(definition, data, request) {
    const workflowEntityHandler = new WorkflowEntityHandler(definition);
    workflowEntityHandler.afterEntityUpdate(data, request);
  }
}

module.exports = WorkflowHandler;

class WorkflowEntityHandler {
  constructor(definition) {
    this.entityDefinition = definition || {};
    this.definitionId = _getAnnotatedValue(this.entityDefinition, DEFINITION_ID_ANNOTATION);
    this.keyPropertyNames = _getKeyPropertyNames(this.entityDefinition);
    this.startDataObjectName = _getAnnotatedValue(this.entityDefinition, START_DATAOBJECT_ANNOTATION);
    this.startPropertyNames = _getStartPropertyNames(this.entityDefinition, this.startDataObjectName);
    this.taskPropertyNames = _getPropertyNames(this.entityDefinition);
    this.taskEnabled = _isTaskEnabled(this.entityDefinition);
  }

  getStartContext(data) {
    const startContext = {};
    if (data) {
      const keyObject = {};
      this.keyPropertyNames.forEach(name => {
        if (data[name] !== undefined) {
          keyObject[name] = data[name];
        }
      });
      startContext[CAP_ENTITY_KEY_NAME] = keyObject;
      const startDataObject = {};
      this.startPropertyNames.forEach(name => {
        if (data[name] !== undefined) {
          startDataObject[name] = data[name];
        }
      });
      if (this.startDataObjectName) {
        // [backward compatibility]
        startContext[this.startDataObjectName] = startDataObject;
      } else {
        Object.assign(startContext, startDataObject);
      }
    }
    return startContext;
  }

  getTaskContext(data) {
    if (this.startDataObjectName) {
      // [backward compatibility]
      return {};
    } else {
      const taskContext = {};
      if (data) {
        this.taskPropertyNames.forEach(name => {
          if (data[name] !== undefined) {
            taskContext[name] = data[name];
          }
        });
      }
      return taskContext;
    }
  }

  async afterEntityCreate(data, request) {
    if (request) {
      console.debug('[lcap] The create workflow entity after event handler is trigerred.');
      request.on('succeeded', async () => {
        try {
          console.debug('[lcap] The create workflow entity request succeeded event handler is trigerred.');
          if (this.definitionId) {
            const workflowService = _getWorkflowService();
            if (workflowService) {
              const accessToken = await _getAccessToken(workflowService, request);
              if (accessToken) {
                console.info('[lcap] Starting workflow with definition ID "' + this.definitionId + '"...');
                const workflowResponse = await axios.request({
                  url: workflowService.endpoints.workflow_rest_url + '/v1/workflow-instances',
                  method: "post",
                  data: {
                    "definitionId": this.definitionId,
                    "context": this.getStartContext(data)
                  },
                  headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                  },
                });
                if (workflowResponse.status === 201) {
                  console.info('[lcap] Workflow "' + workflowResponse.data.id + '" successfully started.');
                } else {
                  console.debug(workflowResponse);
                  console.error('[lcap] Workflow "' + workflowResponse.data.id + '" failed to started (' + workflowResponse.status + ').');
                }
              }
            } else {
              console.error('[lcap] Failed to find the workflow service.');
            }
          }
        } catch (error) {
          _dumpCaughtError(error);
        }
      });
    }
  }

  async afterEntityUpdate(data, request) {
    if (request) {
      console.debug('[lcap] The update workflow entity after event handler is trigerred.');
      request.on('succeeded', async () => {
        try {
          console.debug('[lcap] The update workflow entity request succeeded event handler is trigerred.');
          const taskInstanceId = request._.req.get("x-taskInstanceId");
          const taskDecisionId = request._.req.get("x-taskDecisionId");
          console.debug('[lcap] update for taskInstanceId = ' + JSON.stringify(taskInstanceId) + ' and taskDecisionId = ' + JSON.stringify(taskDecisionId));
          if (taskInstanceId && taskDecisionId && this.taskEnabled) {
            const workflowService = _getWorkflowService();
            if (workflowService) {
              const accessToken = await _getAccessToken(workflowService, request);
              if (accessToken) {
                console.info('[lcap] Updating workflow task with instance ID "' + taskInstanceId + '"...');
                const workflowResponse = await axios.request({
                  url: workflowService.endpoints.workflow_rest_url + `/v1/task-instances/${taskInstanceId}`,
                  method: "patch",
                  data: {
                    "decision": taskDecisionId,
                    "context": this.getTaskContext(data),
                    "status": "COMPLETED"
                  },
                  headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                  },
                });
                if (workflowResponse.status === 204) {
                  console.info('[lcap] Workflow task "' + taskInstanceId + '" successfully updated.');
                } else {
                  console.debug(workflowResponse);
                  console.error('[lcap] Workflow task "' + taskInstanceId + '" failed to updated (' + workflowResponse.status + ').');
                }
              }
            } else {
              console.error('[lcap] Failed to find the workflow service.');
            }
          }
        } catch (error) {
          _dumpCaughtError(error);
        }
      });
    }
  }
}

function _getAnnotatedValue(definition, annotation) {
  const pathAnnotationValue = definition[annotation] && definition[annotation]['='];
  const textAnnotationValue = definition[annotation];
  return pathAnnotationValue || textAnnotationValue || '';
}

function _getStartPropertyNames(definition, startDataObjectName) {
  if (startDataObjectName) {
    // [backward compatibility]
    const propertyNames = [];
    Object.entries(definition.elements).forEach(([name, property]) => {
      if (property[START_PROPERTY_ANNOTATION]) {
        propertyNames.push(name);
      }
    });
    return propertyNames;
  } else {
    return _getPropertyNames(definition);
  }
}

function _getPropertyNames(definition) {
  const propertyNames = [];
  Object.entries(definition.elements).forEach(([name, property]) => {
    if (!property['@UI.Hidden']) {
      propertyNames.push(name);
    }
  });
  return propertyNames;
}

function _getKeyPropertyNames(definition) {
  const keyPropertyNames = [];
  Object.entries(definition.elements).forEach(([name, property]) => {
    if (property.key && !property['@UI.Hidden']) {
      keyPropertyNames.push(name);
    }
  });
  return keyPropertyNames;
}

function _isTaskEnabled(definition) {
  if (definition.includes) {
    return definition.includes.findIndex(function (include) {
      return include === TASK_ENABLED_ASPECT;
    }) >= 0;
  }

  return false;
}

function _getWorkflowService() {
  try {
    return xsenv.getServices({ workflow: { label: 'workflow' } }).workflow;
  } catch (error) {
    console.error(error.message);
  }
}

function _getXSUAAService() {
  try {
    return xsenv.getServices({ xsuaa: { tag: 'xsuaa' } }).xsuaa;
  } catch (error) {
    console.error(error.message);
  }
}

async function _getAccessToken(service, request) {
  try {
    if (request && request.headers.authorization && request.headers.authorization.split(' ').length > 1) {
      const requestToken = request.headers.authorization.split(' ')[1];
      if (requestToken) {
        return new Promise((resolve, reject) => {
          const xsuaa = _getXSUAAService();
          if (xsuaa) {
            xssec.createSecurityContext(requestToken, xsuaa, (error, securityContext) => {
              if (error) {
                console.error('[lcap] Workflow createSecurityContext ERROR:');
                reject(error);
              } else {
                securityContext.requestToken(service.uaa, xssec.constants.TYPE_USER_TOKEN, null, async (error, accessToken) => {
                  if (error) {
                    console.error('[lcap] Workflow requestToken ERROR:');
                    reject(error);
                  } else {
                    resolve(accessToken);
                  }
                });
              }
            });
          }
        }).catch(error => {
          console.error(error.message);
        });
      }
    }
  } catch (error) {
    console.error(error.message);
  }
}

function _dumpCaughtError(error) {
  const responseError = error.response && error.response.data;
  if (responseError) {
    console.debug(responseError);
  }
  console.error(error.message);
}
