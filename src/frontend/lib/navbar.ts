import { SessionUserId, SessionUser } from "../../schema";

export function updateStatus(
  kind: "active" | "inactive" | "error",
  title: string,
  reason?: string
): void {
  const buttonElement = document.getElementById("status-button")!;
  buttonElement.classList.remove("active", "inactive", "error");
  buttonElement.classList.add(kind);
  buttonElement.classList.remove("hidden");
  buttonElement.textContent = title;

  const reasonElement = document.getElementById("status-reason")!;
  if (reason != null) {
    reasonElement.textContent = reason;
    reasonElement.classList.remove("hidden");
  } else {
    reasonElement.classList.add("hidden");
    reasonElement.textContent = "";
  }
}

export function addMember(member: SessionUser, self: boolean): void {
  const membersEl = document.getElementById("members")!;
  let element = document.getElementById(member.id);
  if (element != null) {
    return;
  }
  element = document.createElement("div");
  membersEl.append(element);
  element.id = member.id;
  element.classList.add("member");
  if (self) {
    element.classList.add("self");
  }
  if (member.image != null) {
    element.style.backgroundImage = `url(${member.image})`;
    element.style.backgroundSize = "cover";
  } else {
    element.textContent = member.name.slice(0, 2);
  }
  const selfEl = document.querySelector(".member.self");
  if (selfEl != null) {
    membersEl.append(selfEl);
  }
}
export function deleteMember(member: SessionUserId): void {
  document.getElementById(member)?.remove();
}
