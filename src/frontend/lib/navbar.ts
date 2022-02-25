import { UserId } from "../../schema";

export function updateStatus(
  kind: "active" | "inactive" | "error",
  text: string
): void {
  const element = document.getElementById("status")!;
  element.classList.remove("hidden");
  element.classList.remove("active", "inactive", "error");
  element.classList.add(kind);
  element.textContent = text;
}

export function addMember(member: UserId, self: boolean): void {
  const membersEl = document.getElementById("members")!;
  const [prefix, name] = member.split("/");
  let element = document.getElementById(member);
  if (element != null) {
    return;
  }
  element = document.createElement("div");
  membersEl.append(element);
  element.id = member; // スラッシュが入っているので被らないはず...
  element.classList.add("member");
  if (self) {
    element.classList.add("self");
  }
  switch (prefix) {
    case "ua": {
      element.textContent = name.slice(0, 2);
      break;
    }
    case "gh": {
      element.style.backgroundImage = `https://github.com/${member}.png`;
      break;
    }
    case "sl": {
      element.textContent = name.slice(0, 2); // TODO: avatar
      break;
    }
  }
  const selfEl = document.querySelector(".member.self");
  if (selfEl != null) {
    membersEl.append(selfEl);
  }
}
export function deleteMember(member: UserId): void {
  document.getElementById(member)?.remove();
}
