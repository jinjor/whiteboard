(async () => {
  if (location.protocol === "http:") {
    const button = document.createElement("button");
    button.textContent = "Create Room for Debug";
    button.onclick = async () => {
      const res = await fetch("/api/rooms/", {
        method: "POST",
      });
      if (res.status !== 200) {
        const errMessage = await res.text();
        addLog("Failed to create room");
        return;
      }
      const roomName_ = await res.text();
      location.href = "/rooms/" + roomName_;
    };
    document.body.append(button);
  }
})();
function addLog(message: string) {
  const div = document.createElement("div");
  div.innerText = message;
  document.body.append(div);
}
