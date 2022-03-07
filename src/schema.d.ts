/**
 * @minLength 36
 * @maxLength 36
 */
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
  id: ObjectId;
  kind: "text";
  position: Position;
  text: string;
};
export type PathBody = {
  id: ObjectId;
  kind: "path";
  d: string;
};
export type ObjectBody = TextBody | PathBody;
export type Object_ = ObjectHead & ObjectBody;
export type Objects = Record<ObjectId, Object_>;
export type RequestEventHead = {
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
  value: { old: any; new: any };
};
export type DeleteEventBody = {
  kind: "delete";
  object: ObjectBody;
};
export type InitEventBody = {
  kind: "init";
  objects: Objects;
  members: SessionUser[];
  self: UserId;
};
export type JoinEventBody = {
  kind: "join";
  user: SessionUser;
};
export type QuitEventBody = {
  kind: "quit";
  id: UserId;
};
export type UpsertEventBody = {
  kind: "upsert";
  object: Object_;
};
export type DeletedEventBody = {
  kind: "delete";
  id: ObjectId;
};
export type RequestEventBody = AddEventBody | PatchEventBody | DeleteEventBody;
export type ResponseEventBody =
  | InitEventBody
  | JoinEventBody
  | QuitEventBody
  | UpsertEventBody
  | DeletedEventBody;
export type RequestEvent = RequestEventHead & RequestEventBody;
export type ResponseEvent = ResponseEventBody;
export type RoomId = string;
export type Room = {
  id: RoomId;
  active: boolean;
  createdAt: Timestamp;
};
export type RoomInfo = Room & {
  activeUntil: Timestamp;
  aliveUntil: Timestamp;
};
export type User = {
  id: UserId;
  name: string;
  image: string | null;
};
export type SessionUserId = string;
export type SessionUser = {
  id: SessionUserId;
  name: string;
  image: string | null;
};
export type CloseReason =
  | "room_got_inactive"
  | "no_recent_activity"
  | "rate_limit_exceeded"
  | "duplicated_self"
  | "invalid_data"
  | "unexpected";
