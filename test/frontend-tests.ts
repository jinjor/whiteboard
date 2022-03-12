import * as assert from "assert";
import { JSDOM } from "jsdom";
import { update, createState } from "../src/frontend/logic";

describe("frontend", () => {
  beforeEach(() => {
    const dom = new JSDOM(
      `<html>
         <body>
            <div id="container">
            <nav>
              <div id="status">
                <div id="status-button" class="hidden"></div>
                <div id="status-reason" class="hidden"></div>
              </div>
              <div id="members"></div>
            </nav>
            <div id="help" class="hidden">
              <div class="text-help shortcuts">
                <div>Double-click: Text</div>
                <div>Right-drag: Select</div>
                <div>Select & Drag: Move</div>
                <div>Select & Backspace: Delete</div>
                <div>
                  <span class="hidden-mac">Ctrl</span
                  ><span class="shown-mac">⌘</span> + A: Select All
                </div>
                <div>
                  <span class="hidden-mac">Ctrl</span
                  ><span class="shown-mac">⌘</span> + Z: Undo
                </div>
                <div>
                  <span class="hidden-mac">Ctrl</span
                  ><span class="shown-mac">⌘</span> + Shift + Z,
                  <span class="hidden-mac">Ctrl</span
                  ><span class="shown-mac">⌘</span> + Y: Redo
                </div>
              </div>
            </div>
            <div id="help-touch" class="hidden">
              <div id="shortcut-buttons" class="hidden">
                <button id="undo" disabled>
                  <svg style="width: 24px; height: 24px" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z"
                    />
                  </svg>
                </button>
                <button id="redo" disabled>
                  <svg style="width: 24px; height: 24px" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z"
                    />
                  </svg>
                </button>
                <button id="select">
                  <svg style="width: 24px; height: 24px" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M4,3H5V5H3V4A1,1 0 0,1 4,3M20,3A1,1 0 0,1 21,4V5H19V3H20M15,5V3H17V5H15M11,5V3H13V5H11M7,5V3H9V5H7M21,20A1,1 0 0,1 20,21H19V19H21V20M15,21V19H17V21H15M11,21V19H13V21H11M7,21V19H9V21H7M4,21A1,1 0 0,1 3,20V19H5V21H4M3,15H5V17H3V15M21,15V17H19V15H21M3,11H5V13H3V11M21,11V13H19V11H21M3,7H5V9H3V7M21,7V9H19V7H21Z"
                    />
                  </svg>
                </button>
                <button id="delete" class="delete hidden">
                  <svg style="width: 24px; height: 24px" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"
                    />
                  </svg>
                </button>
              </div>
              <div class="text-help shortcuts">
                <div>Long tap: Text</div>
                <div>Select & Drag: Move</div>
              </div>
            </div>
            <input id="input" class="hidden" />
            <svg id="board" viewBox="0 0 0 0">
              <clipPath id="clip">
                <rect id="board-clip-rect" x="0" y="0" width="0" height="0" />
              </clipPath>
              <rect
                id="board-background"
                x="0"
                y="0"
                width="0"
                height="0"
                fill="white"
              />
              <rect id="board-selector" fill="none" stroke="none" stroke-width="0" />
            </svg>
          </div>
         </body>
       </html>`,
      { url: "http://example.com/rooms/a" }
    );
    (global as any).window = dom.window;
    global.document = dom.window.document;
    global.WebSocket = dom.window.WebSocket;
  });
  it("creates websocket at initialization", async () => {
    const trace: number[] = [];
    const state = createState({
      getRoomInfo: async () => {
        trace.push(1);
        return {
          id: "a",
          active: true,
          createdAt: Date.now(),
          activeUntil: Date.now() + 1000,
          aliveUntil: Date.now() + 2000,
        };
      },
      getObjects: async () => {
        throw new Error();
      },
      createRoom: async () => {
        throw new Error();
      },
      createWebsocket: (wsRoot: string, roomId: string) => {
        assert.strictEqual(roomId, "a");
        trace.push(2);
        return new WebSocket(`${wsRoot}/api/rooms/${roomId}/websocket`);
      },
      send: () => {
        throw new Error();
      },
    });
    await update({ kind: "room:init" }, state, () => {});
    assert.deepStrictEqual(trace, [1, 2]);
  });
});
