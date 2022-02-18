export type ObjectId = string;
export type UserId = string;
export type Timestamp = number;
export type ObjectHead = {
  id: ObjectId;
  lastEditedAt: Timestamp;
  lastEditedBy: UserId;
};
export type Position = {
  x: number;
  y: number;
};
export type TextBody = {
  kind: "text";
  position: Position;
  text: string;
};
export type PathBody = {
  kind: "path";
  points: Position[];
};
export type ObjectBody = TextBody | PathBody;
export type Object_ = ObjectHead & ObjectBody;
export type EventHead = {
  requestedBy: UserId;
  uniqueTimestamp: Timestamp;
};
export type AddEventBody = {
  kind: "add";
  object: ObjectBody;
};
export type PatchEventBody = {
  kind: "patch";
  id: ObjectId;
  key: string;
  value: any;
};
export type DeleteEventBody = {
  kind: "delete";
  id: ObjectId;
};
export type EventBody = AddEventBody | PatchEventBody | DeleteEventBody;
export type Event_ = EventHead & EventBody;
export type RequestEvent = Event_;
export type ResponseEvent = Event_; // TODO
