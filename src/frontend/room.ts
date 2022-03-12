import { api } from "./lib/api";
import { ApplicationEvent, update, createState } from "./logic";

async function run() {
  const state = createState(api);
  const effect = (e: ApplicationEvent) => update(e, state, effect);
  update({ kind: "room:init" }, state, effect);
}
run();
