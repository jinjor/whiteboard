import { Router } from "itty-router";
import { Room, RoomInfo } from "../schema";
import { Config, defaultConfig } from "./config";

export type RoomPatch = {
  id: string;
  active: boolean;
  alive: boolean;
};

class RoomManagerState {
  private storage: DurableObjectStorage;
  private MAX_ACTIVE_ROOMS!: number;
  private LIVE_DURATION!: number;
  private ACTIVE_DURATION!: number;
  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.updateConfig(defaultConfig);
  }
  getConfig(): Partial<Config> {
    return {
      MAX_ACTIVE_ROOMS: this.MAX_ACTIVE_ROOMS,
      LIVE_DURATION: this.LIVE_DURATION,
      ACTIVE_DURATION: this.ACTIVE_DURATION,
    };
  }
  updateConfig(config: Partial<Config>): void {
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
  private makeRoomInfo(room: Room): RoomInfo {
    return {
      ...room,
      activeUntil: room.createdAt + this.ACTIVE_DURATION,
      aliveUntil: room.createdAt + this.LIVE_DURATION,
    };
  }
  async getRoom(roomId: string): Promise<RoomInfo | null> {
    const room = (await this.storage.get(roomId)) as Room | null;
    if (room == null) {
      return null;
    }
    return this.makeRoomInfo(room);
  }
  async createRoom(roomId: string): Promise<Room | null> {
    let activeRooms = 0;
    for (const room of await this.listRoom()) {
      if (room.active) {
        activeRooms++;
      }
    }
    if (activeRooms >= this.MAX_ACTIVE_ROOMS) {
      return null;
    }
    const room = {
      id: roomId,
      createdAt: Date.now(),
      active: true,
    };
    await this.setRoom(room);
    return room;
  }
  async setRoom(room: Room): Promise<void> {
    await this.storage.put(room.id, room);
  }
  async deleteRoom(roomId: string): Promise<void> {
    await this.storage.delete(roomId);
  }
  async listRoom(): Promise<RoomInfo[]> {
    const map = (await this.storage.list()) as Map<string, Room>;
    return [...map.values()].map((room) => this.makeRoomInfo(room));
  }
  async dryClean(): Promise<RoomPatch[]> {
    const list: RoomPatch[] = [];
    for (const room of await this.listRoom()) {
      const now = Date.now();
      list.push({
        id: room.id,
        active: now - room.createdAt < this.ACTIVE_DURATION,
        alive: now - room.createdAt < this.LIVE_DURATION,
      });
    }
    return list;
  }
  async clean(patches: RoomPatch[]): Promise<void> {
    for (const patch of patches) {
      const room = await this.getRoom(patch.id);
      if (room == null) {
        continue;
      }
      if (!patch.alive) {
        await this.deleteRoom(room.id);
        continue;
      }
      if (!patch.active) {
        room.active = false;
        await this.setRoom(room);
      }
    }
  }
  async reset(): Promise<void> {
    this.updateConfig(defaultConfig);
    await this.storage.deleteAll();
  }
}

const roomManagerRouter = Router()
  .delete("/", async (request: Request, state: RoomManagerState) => {
    await state.reset();
    return new Response();
  })
  .get("/config", async (request: Request, state: RoomManagerState) => {
    return new Response(JSON.stringify(state.getConfig()));
  })
  .patch("/config", async (request: Request, state: RoomManagerState) => {
    const config = await request.json();
    await state.updateConfig(config as any);
    return new Response();
  })
  .get("/clean", async (request: Request, state: RoomManagerState) => {
    const list = await state.dryClean();
    return new Response(JSON.stringify({ patches: list }));
  })
  .post("/clean", async (request: Request, state: RoomManagerState) => {
    const { patches } = await request.json();
    await state.clean(patches);
    return new Response();
  })
  .get("/rooms", async (request: Request, state: RoomManagerState) => {
    const rooms = await state.listRoom();
    return new Response(JSON.stringify(rooms));
  })
  .get(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const room = await state.getRoom(roomId);
      if (room == null) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(JSON.stringify(room));
    }
  )
  .put(
    "/rooms/:roomId",
    async (
      request: Request & { params: { roomId: string } },
      state: RoomManagerState
    ) => {
      const roomId = request.params.roomId;
      const exsistingRoom = await state.getRoom(roomId);
      if (exsistingRoom != null) {
        return new Response(JSON.stringify(exsistingRoom));
      }
      const newRoom = await state.createRoom(roomId);
      if (newRoom == null) {
        return new Response("The maximum number of rooms has been reached.", {
          status: 403,
        });
      }
      return new Response(JSON.stringify(newRoom));
    }
  )
  .all("*", () => new Response("Not found.", { status: 404 }));

export class RoomManager implements DurableObject {
  private state: RoomManagerState;

  constructor(controller: any) {
    this.state = new RoomManagerState(controller.storage);
  }
  async fetch(request: Request) {
    return roomManagerRouter.handle(request, this.state).catch((error: any) => {
      console.log(error);
      return new Response("unexpected error", { status: 500 });
    });
  }
}
