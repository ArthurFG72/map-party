const appJson = require('./app.json');

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const plugins = [...(appJson.expo.plugins || [])];

plugins.push([
  'react-native-maps',
  { androidGoogleMapsApiKey: googleMapsApiKey }
]);
plugins.push('@maplibre/maplibre-react-native');
plugins.push('./plugins/withNearbyConnections');
plugins.push('./plugins/withSiriIntents');

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    updates: { enabled: false },
    runtimeVersion: appJson.expo.runtimeVersion || appJson.expo.version,
    plugins,
    android: {
      ...appJson.expo.android,
      config: {
        ...appJson.expo.android?.config,
        googleMaps: {
          ...appJson.expo.android?.config?.googleMaps,
          apiKey: googleMapsApiKey
        }
      }
    }
  }
};
