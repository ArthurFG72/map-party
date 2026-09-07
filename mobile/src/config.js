import Constants from 'expo-constants';

function developmentServerUrl() {
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost || '';
  const host = hostUri.split(':')[0];
  return host ? `http://${host}:3001` : 'http://localhost:3001';
}

export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || developmentServerUrl()).replace(/\/$/, '');
