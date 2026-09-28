import Constants from 'expo-constants';

const PUBLIC_SERVER_URL = 'https://18-228-44-32.sslip.io';

export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || PUBLIC_SERVER_URL).replace(/\/$/, '');
export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
