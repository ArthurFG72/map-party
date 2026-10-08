const appJson = require('./app.json');

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const plugins = [...(appJson.expo.plugins || [])];
const infoPlist = {
  ...appJson.expo.ios?.infoPlist,
  NSLocationAlwaysAndWhenInUseUsageDescription: 'O Map Party mantém sua rota atualizada em segundo plano.',
  NSLocationWhenInUseUsageDescription: 'O Map Party usa sua localização enquanto o app está aberto para mostrá-la aos participantes da party.',
  NSLocalNetworkUsageDescription: 'O Map Party acessa a rede local para sincronizar a party.',
  NSBluetoothAlwaysUsageDescription: 'O Map Party usa Bluetooth para retransmitir pedidos SOS próximos.',
  NSBluetoothPeripheralUsageDescription: 'O Map Party anuncia pedidos SOS para aparelhos próximos.',
  NSMicrophoneUsageDescription: 'Permitir o microfone para ouvir comandos de navegação.',
  NSSpeechRecognitionUsageDescription: 'Permitir o reconhecimento de voz para converter comandos em texto.',
  NSSiriUsageDescription: 'Permitir que a Siri execute comandos de navegação do Map Party.'
};

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
    name: 'Passeio das Águias',
    ios: {
      ...appJson.expo.ios,
      infoPlist
    },
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
