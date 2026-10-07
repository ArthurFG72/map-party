const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject
} = require('@expo/config-plugins');

const SOURCE = path.join(__dirname, 'native', 'ios', 'MapPartySiriIntents.swift');

module.exports = function withSiriIntents(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSSiriUsageDescription = 'Permitir que a Siri execute comandos de navegação do Map Party.';
    return mod;
  });

  config = withDangerousMod(config, ['ios', async (mod) => {
    const { platformProjectRoot, projectName } = mod.modRequest;
    const destination = path.join(platformProjectRoot, projectName, 'MapPartySiriIntents.swift');
    fs.copyFileSync(SOURCE, destination);
    return mod;
  }]);

  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const { projectName } = mod.modRequest;
    const target = IOSConfig.Target.findSignableTargets(project)[0];
    if (!target) throw new Error('Não foi possível localizar o target iOS do Map Party.');
    const filepath = `${projectName}/MapPartySiriIntents.swift`;
    if (!project.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project,
        targetUuid: target.uuid
      });
    }
    return mod;
  });
};
