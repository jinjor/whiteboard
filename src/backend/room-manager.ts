import { Router } from "itty-router";

const MAX_ACTIVE_ROOMS = 10;
const LIVE_DURATION = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_DURATION = 24 * 60 * 60 * 1000;

export type RoomInfo = {
  id: string;
  active: boolean;
  createdAt: number;
};

export type RoomPatch = {
  id: string;
  active: boolean;
  alive: boolean;
};

class RoomManagerState {
  private storage: DurableObjectStorage;
  private MAX_ACTIVE_ROOMS;
  private LIVE_DURATION;
  private ACTIVE_DURATION;
  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.MAX_ACTIVE_ROOMS = MAX_ACTIVE_ROOMS;
    this.LIVE_DURATION = LIVE_DURATION;
    this.ACTIVE_DURATION = ACTIVE_DURATION;
  }
  async updateConfig(config: {
    MAX_ACTIVE_ROOMS?: number;
    LIVE_DURATION?: number;
    ACTIVE_DURATION?: number;
  }): Promise<void> {
    if (config.MAX_ACTIVE_ROOMS != null) {
      this.MAX_ACTIVE_ROOMS = config.MAX_ACTIVE_ROOMS;
    }
    if (config.LIVE_DURATION != null) {
      this.LIVE_DURATION = config.LIVE_DURATION;
    }
    if (config.ACTIVE_DURATION != null) {
      this.ACTIVE_DURATION = config.ACTIVE_DURATION;
    }
  }
  async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
    const roomInfo = await this.storage.get(roomId);
    return (roomInfo ?? null) as RoomInfo | null;
  }
  async createRoomInfo(roomId: string): Promise<RoomInfo | null> {
    let activeRooms = 0;
    for (const roomInfo of await this.listRoomInfo()) {
      if (roomInfo.active) {
        activeRooms++;
      }
    }
    console.log("activeRooms:", activeRooms);
    if (activeRooms >= this.MAX_ACTIVE_ROOMS) {
      return null;
    }
    const roomInfo = {
      id: roomId,
      createdAt: Date.now(),
      active: true,
    };
    await this.setRoomInfo(roomInfo);
    return roomInfo;
  }
  async setRoomInfo(roomInfo: RoomInfo): Promise<void> {
    await this.storage.put(roomInfo.id, roomInfo);
  }
  async deleteRoomInfo(roomId: string): Promise<void> {
    await this.storage.delete(roomId);
  }
  async listRoomInfo(): Promise<RoomInfo[]> {
    const map = (await this.storage.list()) as Map<string, RoomInfo>;
    return [...map.values()];
  }
  async dryClean(): Promise<RoomPatch[]> {
    const list: RoomPatch[] = [];
    for (const roomInfo of await this.listRoomInfo()) {
      const now = Date.now();
      list.push({
        id: roomInfo.id,
        active: now - roomInfo.createdAt < this.ACTIVE_DURATION,
        alive: now - roomInfo.createdAt < this.LIVE_DURATION,
      });
    }
    return list;
  }
  async clean(patches: RoomPatch[]): Promise<void> {
    for (const patch of patches) {
      const roomInfo = await this.getRoomInfo(patch.id);
      if (roomInfo == null) {
        continue;
      }
      if (!patch.alive) {
        await this.deleteRoomInfo(roomInfo.id);
        continue;
      }
      if (!patch.active) {
        roomInfo.active = false;
        await this.setRoomInfo(roomInfo);
      }
    }
  }
  async reset(): Promise<void> {
    this.MAX_ACTIVE_ROOMS = MAX_ACTIVE_ROOMS;
    this.LIVE_DURATION = LIVE_DURATION;
    this.ACTIVE_DURATION = ACTIVE_DURATION;
    await this.storage.deleteAll();
  }
}

const roomManagerRouter = Router()
  .delete("/", async (request: Request, state: RoomManagerState) => {
    await state.reset();
    return new Response("null", { status: 200 });
  })
  .patch("/config", async (request: Request, state: RoomManagerState) => {
    const config = await request.json();
    await state.updateConfig(config as any);
    return new Response("null", { status: 200 });
  })
  .get("/clean", async (request: Request, state: RoomManagerState) => {
    const list = await state.dryClean();
    return new Response(JSON.stringify({ patches: list }), { status: 200 });
  })
  .post("/clean", async (request: Request, state: RoomManagerState) => {
    const { patches } = await request.json();
    await state.clean(patches);
    return new Response(JSON.stringify(null), { status: 200 });
  })
  .get(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const roomInfo = await state.getRoomInfo(roomId);
      if (roomInfo == null) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(JSON.stringify(roomInfo), { status: 200 });
    }
  )
  .put(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const exsistingRoomInfo = await state.getRoomInfo(roomId);
      if (exsistingRoomInfo != null) {
        return new Response(JSON.stringify(exsistingRoomInfo), { status: 200 });
      }
      const newRoomInfo = await state.createRoomInfo(roomId);
      if (newRoomInfo == null) {
        return new Response("The maximum number of rooms has been reached.", {
          status: 403,
        });
      }
      return new Response(JSON.stringify(newRoomInfo), { status: 200 });
    }
  )
  .all("*", () => new Response("Not found.", { status: 404 }));

export class RoomManager implements DurableObject {
  private state: RoomManagerState;

  constructor(controller: any) {
    this.state = new RoomManagerState(controller.storage);
  }
  async fetch(request: Request) {
    console.log("RoomManager's fetch(): " + request.method, request.url);
    return roomManagerRouter.handle(request, this.state).catch((error: any) => {
      console.log("RoomManager:", error);
      return new Response("unexpected error", { status: 500 });
    });
  }
}
