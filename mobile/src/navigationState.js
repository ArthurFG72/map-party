export const CONNECTION_STATE = Object.freeze({
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  CONNECTING: "CONNECTING"
});

export const NAVIGATION_STATE = Object.freeze({
  IDLE: "IDLE",
  NAVIGATING: "NAVIGATING",
  PAUSED: "PAUSED",
  RECALCULATING: "RECALCULATING",
  ARRIVED: "ARRIVED",
  ERROR: "ERROR"
});

export function createNavigationState() {
  return { connection: CONNECTION_STATE.CONNECTING, navigation: NAVIGATION_STATE.IDLE };
}

export function transitionNavigation(state = createNavigationState(), event = {}) {
  switch (event.type) {
    case "connection.online": return { ...state, connection: CONNECTION_STATE.ONLINE };
    case "connection.offline": return { ...state, connection: CONNECTION_STATE.OFFLINE };
    case "connection.connecting": return { ...state, connection: CONNECTION_STATE.CONNECTING };
    case "navigation.start": return { ...state, navigation: NAVIGATION_STATE.NAVIGATING };
    case "navigation.pause": return state.navigation === NAVIGATION_STATE.NAVIGATING
      ? { ...state, navigation: NAVIGATION_STATE.PAUSED } : state;
    case "navigation.resume": return state.navigation === NAVIGATION_STATE.PAUSED
      ? { ...state, navigation: NAVIGATION_STATE.NAVIGATING } : state;
    case "navigation.recalculate": return state.navigation === NAVIGATION_STATE.NAVIGATING
      ? { ...state, navigation: NAVIGATION_STATE.RECALCULATING } : state;
    case "navigation.recalculated": return state.navigation === NAVIGATION_STATE.RECALCULATING
      ? { ...state, navigation: NAVIGATION_STATE.NAVIGATING } : state;
    case "navigation.arrived": return { ...state, navigation: NAVIGATION_STATE.ARRIVED };
    case "navigation.cancel": return { ...state, navigation: NAVIGATION_STATE.IDLE };
    case "navigation.error": return { ...state, navigation: NAVIGATION_STATE.ERROR };
    default: return state;
  }
}