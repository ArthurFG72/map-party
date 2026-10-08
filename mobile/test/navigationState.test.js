import assert from "node:assert/strict";
import test from "node:test";
import { CONNECTION_STATE, NAVIGATION_STATE, createNavigationState, transitionNavigation } from "../src/navigationState.js";

test("navegação continua ativa quando a conexão cai", () => {
  let state = createNavigationState();
  state = transitionNavigation(state, { type: "connection.online" });
  state = transitionNavigation(state, { type: "navigation.start" });
  state = transitionNavigation(state, { type: "connection.offline" });
  assert.deepEqual(state, { connection: CONNECTION_STATE.OFFLINE, navigation: NAVIGATION_STATE.NAVIGATING });
});

test("pausar, retomar e recalcular respeita estados válidos", () => {
  let state = transitionNavigation(createNavigationState(), { type: "navigation.start" });
  state = transitionNavigation(state, { type: "navigation.pause" });
  assert.equal(state.navigation, NAVIGATION_STATE.PAUSED);
  state = transitionNavigation(state, { type: "navigation.recalculate" });
  assert.equal(state.navigation, NAVIGATION_STATE.PAUSED);
  state = transitionNavigation(state, { type: "navigation.resume" });
  state = transitionNavigation(state, { type: "navigation.recalculate" });
  assert.equal(state.navigation, NAVIGATION_STATE.RECALCULATING);
  assert.equal(transitionNavigation(state, { type: "navigation.recalculated" }).navigation, NAVIGATION_STATE.NAVIGATING);
});