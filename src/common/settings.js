// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
'use strict';

import fs from 'fs';
import path from 'path';
import winreg from 'winreg';

import buildConfig from './config/buildConfig';
import defaultPreferences from './config/defaultPreferences';
import upgradePreferences from './config/upgradePreferences';

function merge(base, target) {
  return Object.assign({}, base, target);
}

function loadDefault() {
  return JSON.parse(JSON.stringify(defaultPreferences));
}

function hasBuildConfigDefaultTeams(config) {
  return config.defaultTeams.length > 0;
}

function RegistryItemNotFoundException(msg) {
  this.message = msg;
  this.toString = function() {
     return this.message;
  };
}

function getRegistryItemValue(regKey, item) {
  regKey.values(function (err, items /* array of RegistryItem */) {
    if (err) {
      throw new RegistryItemNotFoundException(err);
    }

    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].name === item) {
        return items[i].value;
      }
    }
    if (i == items.length) {
      throw new RegistryItemNotFoundException(err);
    }
  });
}

function isAddingNewServerPreventedByGPO() {

  try {
    var regKey = new Registry({
      hive: Registry.HKCU,
      key:  '\\Software\\Policies\\Mattermost'
    })
    var regItemValue = getRegistryItemValue(regKey, "PreventAddNewServer")
    if (regItemValue === 1) {
      return true;
    }
  } catch (RegistryItemNotFoundException) {
    var regKey = new Registry({
      hive: Registry.HKLM,
      key:  '\\Software\\Policies\\Mattermost'
    })
    var regItemValue = getRegistryItemValue(regKey, "PreventAddNewServer")
    if (regItemValue === 1) {
      return true;
    }
  }
  return false;
}

function getDefaultServerListFromGPO() {
  var servers = [];
  var registryItems = [];
  try {
    var regKey = new Registry({
      hive: Registry.HKCU,
      key:  '\\Software\\Policies\\Mattermost\\DefaultServerList'
    })
    regKey.values(function (err, items /* array of RegistryItem */) {
      if (err) {
        throw new RegistryItemNotFoundException(err);
      }
      registryItems = items;
    });
  } catch (RegistryItemNotFoundException) {
    var regKey = new Registry({
      hive: Registry.HKLM,
      key:  '\\Software\\Policies\\Mattermost\\DefaultServerList'
    })
    regKey.values(function (err, items /* array of RegistryItem */) {
      if (err) {
        throw new RegistryItemNotFoundException(err);
      }
      registryItems = items;
    });
  }

  for (var i = 0; i < items.length; i++) {
    var server = []
    var nameTokenized = items[i].name.split("|");

    if (typeof nameTokenized[0] != "number") {
      for(var i = 0; i < nameTokenized.length; i++) {
        server.name += nameTokenized[i];
      }
      server.index = false;

    } else {
      for(var i = 1; i < nameTokenized.length; i++) {
        server.name += nameTokenized[i];
      }
      server.index = nameTokenized[0];
    }
    server.url = items[i].value;
    servers.push(server);
  }

  return servers;
}

function upgrade(config) {
  return upgradePreferences(config);
}

function readFileSync(configFile) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (config.version === defaultPreferences.version) {
    const defaultConfig = loadDefault();
    return merge(defaultConfig, config);
  }
  return config;
}

function writeFile(configFile, config, callback) {
  if (config.version !== defaultPreferences.version) {
    throw new Error('version ' + config.version + ' is not equal to ' + defaultPreferences.version);
  }
  const data = JSON.stringify(config, null, '  ');
  fs.writeFile(configFile, data, 'utf8', callback);
}

function writeFileSync(configFile, config) {
  if (config.version !== defaultPreferences.version) {
    throw new Error('version ' + config.version + ' is not equal to ' + defaultPreferences.version);
  }

  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  const data = JSON.stringify(config, null, '  ');
  fs.writeFileSync(configFile, data, 'utf8');
}

function mergeDefaultTeams(servers) {
  const newServers = [];
  if (hasBuildConfigDefaultTeams(buildConfig)) {
    newServers.push(...JSON.parse(JSON.stringify(buildConfig.defaultTeams)));
  }
  if (buildConfig.enableServerManagement) {
    newServers.push(...JSON.parse(JSON.stringify(servers)));
  }
  return newServers;
}

function init(config, app) {
  // appData is
  // * On Windows: %APPDATA%
  // * On GNU/Linux: $XDG_CONFIG_HOME or ~/.config
  // * On macOS: ~/Library/Application Support
  // userData is by default appData appended by the app name.
  // Contrary to the popular belief, on Windows, AppData leads to AppData/Roaming.
  // The config.json resides thus by default in
  // C:/Users/<user>/AppData/Roaming/Mattermost/config.json
  // But userData can be overridden by data-dir passed as argument to the
  // final executable (all OS concerned).
  const configFile = app.getPath('userData') + '/config.json';

  try {
    config = readFileSync(configFile);
    if (config.version !== defaultPreferences.version) {
      config = upgrade(config);
      writeFileSync(configFile, config);
    }
  } catch (e) {
    // The config file does not exist, load defaults
    console.log('Failed to read or upgrade config.json', e);
    config = loadDefault();
  
    // Append config only if we failed because we weren't able to read
    // the config file, not because we weren't able to write back changes to
    // the config file.
    if (!config.teams.length && config.defaultTeam) {
      config.teams.push(config.defaultTeam);
      writeFileSync(configFile, config);
    }
  }

  if (process.platform == "win32") {
    // If the user cannot have their own servers, override with the ones defined
    // in GPO.
    if (isAddingNewServerPrevented()) {
      config.teams = getDefaultServerListFromGPO();
    } else {
      config.teams.push(getDefaultServerListFromGPO());
    }
  }
  
  if (config.enableHardwareAcceleration === false) {
    app.disableHardwareAcceleration();
  }
}

export default {
  init,
  upgrade,
  mergeDefaultTeams
};
