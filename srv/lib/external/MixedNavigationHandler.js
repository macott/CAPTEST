const util = require('./util');

class MixedNavigationHandler {
  /**
   * @example
   * Notes(24B58115-E394-423B-BEAB-53419A32B927)/supplier
   *
   * -->
   * { SELECT: { from: { ref: {[
   *   [ id: 'NotesService.Notes',
   *     where: [
   *       ref: [ 'ID' ],
   *       '=',
   *       val: ''545A3CF9-84CF-46C8-93DC-E29F0F2BC6BE'
   *      ],
   *   ],
   *   [ 'supplier' ]
   * ]}}}
   *
   *
   * @param {*} req
   * @param {*} next
   * @returns
   */
  async resolveMixedNavigation(req/*, next*/) {
    const select = req.query.SELECT;
    const { entityName, entity, associationNames } = util.navigation(req.query);
    let currentEntiy;
    let naviObjects = [];
    associationNames.forEach(associationName => {
      if (!currentEntiy) {
        currentEntiy = entity;
        naviObjects.push(
          {
            "entityName": entityName,
            "associationName": null,
            "entity": entity,
            "service": util.targetServiceOfEntity(entityName)
          }
        )
      }

      let { keyMapping, target } = util.association(currentEntiy, associationName);
      currentEntiy = target;
      naviObjects.push(
        {
          "entityName": target.name,
          "associationName": associationName,
          "targetEntity": target,
          "targetService": util.targetServiceOfEntity(target.name),
          "keyMapping": keyMapping
        }
      )
    });

    // Splite local part and remote part
    const firstChangedServiceIndex = this.getFirstChangedServiceIndex(naviObjects);
    // The key mapping is use to connect the local part and remote part
    const myKeyMapping = naviObjects[firstChangedServiceIndex].keyMapping;
    // A local query CQN template for local query
    let selectLocal =
    {
      SELECT:
      {
        from:
        {
          ref: []
        },
        columns: [],
        one: true
      }
    };
    // Copy the original CQN, only local from part is useful
    selectLocal.SELECT.from.ref = select.from.ref.filter((r, index) => index < firstChangedServiceIndex);
    // Only the key(s) will be used for next remote service query
    Object.keys(myKeyMapping).forEach(key => {
      selectLocal.SELECT.columns.push({ ref: [key] });
    });
    // The first entity name is belong to local service
    const localService = util.targetServiceOfEntity(entityName);
    // Use the Navi object and the first changed service index's entity name get the remote service
    const remoteService = util.targetServiceOfEntity(naviObjects[firstChangedServiceIndex].entityName);
    // Call local query to get the keys 
    const entryLocal = await localService.run(selectLocal);

    // Construct the remote call CQN
    // Using the keys get from local query
    // The CNQ is like the original CQN, just need to remove the local entity infomation
    let addAndOpratorFlag = false;
    let whereArray = [];
    Object.entries(myKeyMapping).forEach(([key, value]) => {
      if (addAndOpratorFlag) {
        whereArray.push("and")
      }
      whereArray.push({ "ref": [value] })
      whereArray.push("=")
      whereArray.push({ "val": entryLocal[key] })
      addAndOpratorFlag = true;
    });
    const remoteCQN = {
      "SELECT": {
        "from": {
          "ref": [
            {
              "id": naviObjects[firstChangedServiceIndex].entityName,
              "where": whereArray,
            }
          ]
        }
      }
    }
    for (let i = 2; i < select.from.ref.length; i++) {
      remoteCQN.SELECT.from.ref[i - 1] = select.from.ref[i]
    }
    select.from = remoteCQN.SELECT.from;
    if (select.where) {
      remoteCQN.SELECT["where"] = select.where;
    }
    const result = await remoteService.run({ "SELECT": select });
    return result;
  }

  // Get first changed service index, to splite the URL to two parts
  // return 0 is all same service
  getFirstChangedServiceIndex(naviObjects) {
    let lastService = naviObjects[0].service
    for (let index = 1; index < naviObjects.length; index++) {
      if (naviObjects[index].service !== lastService) {
        return index;
      }
    }
    return 0;
  }
}

module.exports = MixedNavigationHandler;
