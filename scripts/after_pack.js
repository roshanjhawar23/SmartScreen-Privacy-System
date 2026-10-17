// electron-builder afterPack hook: drop Electron's sample app, which ships when the
// local node_modules/electron/dist is used as electronDist. SmartScreen runs from app.asar.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context){
  const file = path.join(context.appOutDir, 'resources', 'default_app.asar');
  if(fs.existsSync(file)) fs.unlinkSync(file);
};
