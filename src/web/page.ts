/** The entire web UI as a single self-contained HTML document (no build step). */
export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Playlister</title>
<style>
  :root {
    --bg: #0d0d10; --card: #1a1a20; --line: #2a2a33;
    --text: #f2f2f5; --muted: #9a9aa5; --accent: #fa243c; --accent-dim: #3a1820;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  h1 { font-size: 22px; margin: 0; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
  .sub { color: var(--muted); margin: 0 0 28px; font-size: 13px; }
  form { display: flex; gap: 8px; margin-bottom: 12px; }
  input[type=text], input[type=password], select {
    flex: 1; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--card); color: var(--text); font-size: 14px; min-width: 0;
  }
  select { flex: 0 0 auto; }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  button {
    border: none; border-radius: 10px; padding: 11px 16px; font-size: 14px;
    font-weight: 600; cursor: pointer; background: var(--accent); color: #fff;
  }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { background: transparent; color: var(--muted); padding: 6px 10px; font-weight: 500; }
  button.ghost:hover { color: var(--accent); }
  .msg { min-height: 20px; font-size: 13px; margin-bottom: 16px; }
  .msg.err { color: #ff6b6b; }
  .msg.ok { color: #4ad17a; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  li {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 14px 16px; display: flex; align-items: center; gap: 14px;
  }
  .meta { flex: 1; min-width: 0; }
  .name { font-weight: 600; }
  .name a { color: inherit; text-decoration: none; }
  .name a:hover { color: var(--accent); }
  .detail { color: var(--muted); font-size: 12px; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pending { color: var(--muted); font-style: italic; }
  .empty { color: var(--muted); text-align: center; padding: 40px 0; }
  .panel {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 16px; margin-bottom: 18px;
  }
  .panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--muted); margin: 0 0 10px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .status { font-size: 12px; margin-top: 8px; }
  .status.on { color: #4ad17a; }
  .status.off { color: #ffb454; }
  code { background: #000; padding: 1px 5px; border-radius: 5px; font-size: 12px; }
  #add { flex-direction: column; }
  .hint { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
  .hook-line { color: var(--muted); font-size: 12px; margin-top: 4px;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .tag.custom { color: #7aa2ff; }
  .err-line { color: #ff6b6b; font-size: 12px; margin-top: 4px; }
  .link { background: none; border: none; color: var(--accent); cursor: pointer;
    padding: 0; font-size: 12px; font-weight: 600; }
  .hook-edit { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  .hook-edit input { font-size: 13px; padding: 7px 10px; }
  .hook-edit select { font-size: 13px; padding: 7px 10px; }
  .hook-edit button { padding: 7px 11px; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <header><span class="dot"></span><h1>Playlister</h1></header>
  <p class="sub">Watching Apple Music playlists &middot; new songs are posted to Discord.</p>

  <div class="panel">
    <h2>Discord bot token</h2>
    <form id="bot" class="row">
      <input id="botToken" type="password" placeholder="Bot token (needed for channel / thread posting)" autocomplete="off" />
      <button id="botBtn" type="submit">Save</button>
      <button id="botClear" type="button" class="ghost">Clear</button>
    </form>
    <div id="botStatus" class="status"></div>
  </div>

  <div class="panel">
    <h2>Default destination</h2>
    <form id="dest" class="row">
      <select id="destType">
        <option value="webhook">Webhook URL</option>
        <option value="channel">Bot channel / thread</option>
      </select>
      <input id="destVal" type="text" autocomplete="off" />
      <button id="destBtn" type="submit">Save</button>
      <button id="destClear" type="button" class="ghost">Clear</button>
    </form>
    <div id="destStatus" class="status"></div>
    <p class="hint">Used for any playlist without its own destination. Channel/thread posting requires the bot token above, and the bot must be in the server with access to that channel/thread.</p>
  </div>

  <form id="add">
    <div class="row">
      <input id="url" type="text" placeholder="Paste an Apple Music playlist share link…" autocomplete="off" />
      <button id="addBtn" type="submit">Add</button>
    </div>
  </form>
  <div id="msg" class="msg"></div>

  <ul id="list"></ul>
</div>

<script>
const $ = (id) => document.getElementById(id);
const msg = $("msg");

function setMsg(text, kind) { msg.textContent = text || ""; msg.className = "msg" + (kind ? " " + kind : ""); }

function fmtTime(iso) {
  if (!iso) return "not checked yet";
  const d = new Date(iso), s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return "checked just now";
  if (s < 3600) return "checked " + Math.floor(s / 60) + "m ago";
  if (s < 86400) return "checked " + Math.floor(s / 3600) + "h ago";
  return "checked " + d.toLocaleDateString();
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function destLabel(d) {
  if (!d) return "none";
  if (d.type === "webhook") return "webhook · " + d.webhookPreview;
  return "channel/thread " + d.channelId;
}

function placeholderFor(type) {
  return type === "channel"
    ? "Channel / thread ID or link"
    : "https://discord.com/api/webhooks/…";
}

// ---- playlists ----

async function load() {
  const res = await fetch("/api/playlists");
  const { playlists, defaultDestination, botTokenSet } = await res.json();
  const list = $("list");
  if (!playlists.length) {
    list.innerHTML = '<div class="empty">No playlists yet. Add one above.</div>';
    return;
  }
  list.innerHTML = playlists.map((p) => {
    const title = p.name ? esc(p.name) : '<span class="pending">Loading…</span>';
    const nameHtml = p.name
      ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + title + "</a>"
      : title;
    const count = p.trackCount != null ? p.trackCount + " tracks · " : "";
    const id = p.id || "";
    const errLine = p.lastError
      ? '<div class="err-line">⚠ ' + esc(p.lastError) + "</div>"
      : "";

    let summary, cls;
    if (p.usesDefault) {
      summary = "uses default (" + esc(defaultDestination ? destLabel(defaultDestination) : "none set") + ")";
      cls = "tag";
    } else {
      summary = "own " + esc(destLabel(p.destination));
      cls = "tag custom";
    }

    const curType = p.usesDefault ? "none" : p.destination.type;
    const opt = (v, label) => '<option value="' + v + '"' + (v === curType ? " selected" : "") + ">" + label + "</option>";
    const editor = id
      ? '<div class="hook-edit" id="he-' + esc(id) + '" hidden>' +
          '<select class="pl-type">' +
            opt("none", "Use default") + opt("webhook", "Webhook URL") + opt("channel", "Bot channel / thread") +
          "</select>" +
          '<input type="text" class="pl-val" />' +
          '<button data-save="' + esc(id) + '">Save</button>' +
        "</div>"
      : "";
    const editLink = id ? '<button class="link" data-edit="' + esc(id) + '">edit</button>' : "";

    return (
      "<li>" +
        '<div class="meta">' +
          '<div class="name">' + nameHtml + "</div>" +
          '<div class="detail">' + count + fmtTime(p.lastChecked) + "</div>" +
          '<div class="hook-line"><span class="' + cls + '">' + summary + "</span>" + editLink + "</div>" +
          editor +
        "</div>" +
        '<button class="ghost" data-id="' + esc(id) + '" data-url="' + esc(p.url) + '">Remove</button>' +
      "</li>"
    );
  }).join("");

  list.querySelectorAll("button[data-url]").forEach((btn) => {
    btn.onclick = () => remove(btn.dataset.id, btn.dataset.url);
  });
  list.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.onclick = () => { const b = $("he-" + btn.dataset.edit); if (b) b.hidden = !b.hidden; };
  });
  list.querySelectorAll(".hook-edit").forEach((box) => {
    const sel = box.querySelector(".pl-type");
    const val = box.querySelector(".pl-val");
    const sync = () => { val.style.display = sel.value === "none" ? "none" : ""; val.placeholder = placeholderFor(sel.value); };
    sel.onchange = sync; sync();
  });
  list.querySelectorAll("button[data-save]").forEach((btn) => {
    btn.onclick = () => {
      const box = $("he-" + btn.dataset.save);
      const type = box.querySelector(".pl-type").value;
      const value = box.querySelector(".pl-val").value.trim();
      savePlDest(btn.dataset.save, type, value);
    };
  });
}

async function remove(id, url) {
  let res;
  if (id) res = await fetch("/api/playlists/" + encodeURIComponent(id), { method: "DELETE" });
  else res = await fetch("/api/playlists", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
  });
  if (res.ok) { setMsg("Removed.", "ok"); load(); }
  else setMsg("Could not remove playlist.", "err");
}

async function savePlDest(id, type, value) {
  try {
    const res = await fetch("/api/playlists/" + encodeURIComponent(id) + "/destination", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, value }),
    });
    const data = await res.json();
    if (res.ok) { setMsg(type === "none" ? "Reverted to default." : "Playlist destination saved.", "ok"); load(); }
    else setMsg(data.error || "Failed to save destination.", "err");
  } catch (e) { setMsg("Network error.", "err"); }
}

// ---- settings: bot token + default destination ----

async function loadSettings() {
  const s = await (await fetch("/api/settings")).json();

  const bs = $("botStatus");
  if (s.botTokenSet) { bs.className = "status on"; bs.innerHTML = "Bot token set · <code>" + esc(s.botTokenPreview) + "</code>"; }
  else { bs.className = "status off"; bs.textContent = "No bot token — channel/thread posting is disabled."; }

  const ds = $("destStatus");
  if (s.defaultDestination) {
    ds.className = "status on"; ds.innerHTML = "Default: <code>" + esc(destLabel(s.defaultDestination)) + "</code>";
    $("destType").value = s.defaultDestination.type;
  } else {
    ds.className = "status off"; ds.textContent = "No default destination set.";
  }
  $("destVal").placeholder = placeholderFor($("destType").value);
}

$("destType").onchange = () => { $("destVal").placeholder = placeholderFor($("destType").value); };

$("bot").onsubmit = async (e) => {
  e.preventDefault();
  const botToken = $("botToken").value.trim();
  if (!botToken) return;
  $("botBtn").disabled = true;
  try {
    const res = await fetch("/api/settings/bot-token", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ botToken }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("Bot token saved.", "ok"); $("botToken").value = ""; loadSettings(); }
    else setMsg(data.error || "Failed to save bot token.", "err");
  } catch (e) { setMsg("Network error.", "err"); } finally { $("botBtn").disabled = false; }
};

$("botClear").onclick = async () => {
  if (!confirm("Clear the bot token? Channel/thread posting will stop.")) return;
  await fetch("/api/settings/bot-token", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ botToken: "" }),
  });
  setMsg("Bot token cleared.", "ok"); loadSettings();
};

$("dest").onsubmit = async (e) => {
  e.preventDefault();
  const type = $("destType").value;
  const value = $("destVal").value.trim();
  if (!value) return;
  $("destBtn").disabled = true;
  try {
    const res = await fetch("/api/settings/default-destination", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, value }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("Default destination saved.", "ok"); $("destVal").value = ""; loadSettings(); }
    else setMsg(data.error || "Failed to save destination.", "err");
  } catch (e) { setMsg("Network error.", "err"); } finally { $("destBtn").disabled = false; }
};

$("destClear").onclick = async () => {
  if (!confirm("Clear the default destination?")) return;
  await fetch("/api/settings/default-destination", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "none" }),
  });
  setMsg("Default destination cleared.", "ok"); loadSettings();
};

$("add").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  if (!url) return;
  $("addBtn").disabled = true;
  setMsg("Adding…");
  try {
    const res = await fetch("/api/playlists", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("Added " + (data.playlist?.name || "playlist") + ".", "ok"); $("url").value = ""; load(); }
    else setMsg(data.error || "Failed to add playlist.", "err");
  } catch (e) { setMsg("Network error.", "err"); } finally { $("addBtn").disabled = false; }
};

load();
loadSettings();
setInterval(load, 30000);
</script>
</body>
</html>`;
