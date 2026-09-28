const appJson = require('./app.json');

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const plugins = [...(appJson.expo.plugins || [])];

plugins.push([
  'react-native-maps',
  { androidGoogleMapsApiKey: googleMapsApiKey }
]);
plugins.push('@maplibre/maplibre-react-native');

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    updates: {
      ...appJson.expo.updates,
      url: 'https://u.expo.dev/fcce8b86-5921-4af0-aa0b-adab79937f6c'
    },
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
