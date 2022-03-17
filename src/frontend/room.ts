import { api } from "./lib/api";
import { ApplicationEvent, update, createState } from "./logic";

async function run() {
  const env = {
    isMac: window.navigator.userAgent.toLowerCase().indexOf("mac os x") >= 0,
    isTouchDevice:
      window.ontouchstart != null || window.navigator.maxTouchPoints > 0,
  };
  const state = createState(api, env);
  const effect = (e: ApplicationEvent) => update(e, state, effect);
  update({ kind: "room:init" }, state, effect);
}
run();
