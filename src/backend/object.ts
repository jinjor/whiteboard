import {
  RequestEvent,
  Objects,
  ResponseEvent,
  Object_,
  RequestEventBody,
  ObjectId,
} from "../schema";
import { deepEqual } from "../deep-equal";
import { Validator } from "@cfworker/json-schema";
// @ts-ignore
import schemaJson from "../schema.json";

const eventValidator = new Validator(schemaJson.definitions.RequestEventBody);
export function validateEvent(event: any): event is RequestEventBody {
  const result = eventValidator.validate(event);
  return result.valid;
}
const objectValidator = new Validator(schemaJson.definitions.Object_);
function validateObject(object: any): object is Object_ {
  const result = objectValidator.validate(object);
  return result.valid;
}

export class InvalidEvent extends Error {}

export class RoomStorage {
  constructor(private storage: DurableObjectStorage) {}
  async deleteAll(): Promise<void> {
    await this.storage.deleteAll();
  }
  async hasObject(id: ObjectId): Promise<boolean> {
    const object = await this.getObject(id);
    return object != null;
  }
  async getObject(id: ObjectId): Promise<Object_ | undefined> {
    const key = "object/" + id;
    const object = await this.storage.get(key);
    return object as Object_ | undefined;
  }
  async putObject(object: Object_): Promise<void> {
    const key = "object/" + object.id;
    await this.storage.put(key, object);
  }
  async deleteObject(objectId: ObjectId): Promise<void> {
    const key = "object/" + objectId;
    await this.storage.delete(key);
  }
  async getObjects(): Promise<Objects> {
    const objectMap = await this.storage.list({
      prefix: "object/",
    });
    const objects: Objects = {};
    for (const [key, object] of objectMap.entries()) {
      const id = key.slice("object/".length);
      objects[id] = object as Object_;
    }
    return objects;
  }
}

export async function applyEvent(
  event: RequestEvent,
  storage: RoomStorage
): Promise<{ event: ResponseEvent; to: "self" | "others" }[]> {
  const events: { event: ResponseEvent; to: "self" | "others" }[] = [];
  switch (event.kind) {
    case "add": {
      if (await storage.hasObject(event.object.id)) {
        break;
      }
      const newObject = event.object;
      await storage.putObject(newObject);
      events.push({
        event: {
          kind: "upsert",
          object: newObject,
        },
        to: "others",
      });
      break;
    }
    case "patch": {
      const objectId = event.id;
      const oldObject = await storage.getObject(objectId);
      if (oldObject == null) {
        break;
      }
      const oldValue = (oldObject as any)[event.key];
      if (oldValue == null) {
        throw new InvalidEvent();
      }
      if (!deepEqual(oldValue, event.value.old)) {
        break;
      }
      const newObject = {
        ...oldObject,
        [event.key]: event.value.new,
      };
      if (!validateObject(newObject)) {
        throw new InvalidEvent();
      }
      await storage.putObject(newObject);
      events.push({
        event: {
          kind: "upsert",
          object: newObject,
        },
        to: "others",
      });
      break;
    }
    case "delete": {
      const objectId = event.object.id;
      const oldObject = await storage.getObject(objectId);
      if (oldObject == null) {
        break;
      }
      if (!deepEqual(oldObject, event.object)) {
        break;
      }
      await storage.deleteObject(objectId);
      events.push({
        event: {
          kind: "delete",
          id: objectId,
        },
        to: "others",
      });
      break;
    }
  }
  return events;
}
