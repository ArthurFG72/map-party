// Native builds resolve useLocationSharing.ios.js or useLocationSharing.android.js.
// Keep a native fallback for tooling that does not provide a platform suffix.
export { useLocationSharing } from './useLocationSharing.ios';
