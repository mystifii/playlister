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
  input[type=text] {
    flex: 1; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--card); color: var(--text); font-size: 14px;
  }
  input[type=text]:focus { outline: none; border-color: var(--accent); }
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
    padding: 16px; margin-bottom: 24px;
  }
  .panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--muted); margin: 0 0 10px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .status { font-size: 12px; margin-top: 8px; }
  .status.on { color: #4ad17a; }
  .status.off { color: #ffb454; }
  code { background: #000; padding: 1px 5px; border-radius: 5px; font-size: 12px; }
  #add { flex-direction: column; }
  .hint { color: var(--muted); font-size: 12px; margin: -4px 0 0; }
  .hook-line { color: var(--muted); font-size: 12px; margin-top: 4px;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .tag.custom { color: #7aa2ff; }
  .link { background: none; border: none; color: var(--accent); cursor: pointer;
    padding: 0; font-size: 12px; font-weight: 600; }
  .hook-edit { display: flex; gap: 6px; margin-top: 8px; }
  .hook-edit input { font-size: 13px; padding: 7px 10px; }
  .hook-edit button { padding: 7px 11px; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <header><span class="dot"></span><h1>Playlister</h1></header>
  <p class="sub">Watching Apple Music playlists &middot; new songs are posted to Discord.</p>

  <div class="panel">
    <h2>Default Discord webhook</h2>
    <form id="hook" class="row">
      <input id="hookUrl" type="text" placeholder="https://discord.com/api/webhooks/…" autocomplete="off" />
      <button id="hookBtn" type="submit">Save</button>
      <button id="hookClear" type="button" class="ghost">Clear</button>
    </form>
    <div id="hookStatus" class="status"></div>
    <p class="hint">Used for any playlist that doesn't have its own webhook below.</p>
  </div>

  <form id="add">
    <div class="row">
      <input id="url" type="text" placeholder="Paste an Apple Music playlist share link…" autocomplete="off" />
      <button id="addBtn" type="submit">Add</button>
    </div>
    <input id="addHook" type="text" placeholder="Optional: webhook for this playlist (blank = use default)" autocomplete="off" />
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

async function load() {
  const res = await fetch("/api/playlists");
  const { playlists, defaultWebhookSet } = await res.json();
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

    let hookText, hookCls;
    if (p.customWebhook) { hookText = "own webhook · " + esc(p.webhookPreview); hookCls = "tag custom"; }
    else if (defaultWebhookSet) { hookText = "uses default webhook"; hookCls = "tag"; }
    else { hookText = "no webhook — notifications off"; hookCls = "tag"; }

    const editControls = id
      ? '<button class="link" data-edit="' + esc(id) + '">edit</button>'
      : "";
    const editor = id
      ? '<div class="hook-edit" id="he-' + esc(id) + '" hidden>' +
          '<input type="text" placeholder="Discord webhook URL (blank = use default)" />' +
          '<button data-save="' + esc(id) + '">Save</button>' +
          (p.customWebhook ? '<button class="ghost" data-default="' + esc(id) + '">Use default</button>' : "") +
        "</div>"
      : "";

    return (
      "<li>" +
        '<div class="meta">' +
          '<div class="name">' + nameHtml + "</div>" +
          '<div class="detail">' + count + fmtTime(p.lastChecked) + "</div>" +
          '<div class="hook-line"><span class="' + hookCls + '">' + hookText + "</span>" + editControls + "</div>" +
          editor +
        "</div>" +
        '<button class="ghost" data-id="' + esc(id) + '" data-url="' +
          esc(p.url) + '">Remove</button>' +
      "</li>"
    );
  }).join("");

  list.querySelectorAll("button[data-url]").forEach((btn) => {
    btn.onclick = () => remove(btn.dataset.id, btn.dataset.url);
  });
  list.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.onclick = () => {
      const box = $("he-" + btn.dataset.edit);
      if (box) box.hidden = !box.hidden;
    };
  });
  list.querySelectorAll("button[data-save]").forEach((btn) => {
    btn.onclick = () => {
      const input = $("he-" + btn.dataset.save).querySelector("input");
      saveHook(btn.dataset.save, input.value.trim());
    };
  });
  list.querySelectorAll("button[data-default]").forEach((btn) => {
    btn.onclick = () => saveHook(btn.dataset.default, "");
  });
}

async function saveHook(id, webhookUrl) {
  try {
    const res = await fetch("/api/playlists/" + encodeURIComponent(id) + "/webhook", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl }),
    });
    const data = await res.json();
    if (res.ok) { setMsg(webhookUrl ? "Playlist webhook saved." : "Reverted to default webhook.", "ok"); load(); }
    else setMsg(data.error || "Failed to save webhook.", "err");
  } catch (err) {
    setMsg("Network error.", "err");
  }
}

async function remove(id, url) {
  let res;
  if (id) res = await fetch("/api/playlists/" + encodeURIComponent(id), { method: "DELETE" });
  else res = await fetch("/api/playlists", {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (res.ok) { setMsg("Removed.", "ok"); load(); }
  else setMsg("Could not remove playlist.", "err");
}

async function loadSettings() {
  const res = await fetch("/api/settings");
  const s = await res.json();
  const status = $("hookStatus");
  if (s.webhookSet) {
    status.className = "status on";
    status.innerHTML = "Notifications on · <code>" + esc(s.webhookPreview) + "</code>";
    $("hookUrl").placeholder = "Paste a new URL to replace it…";
  } else {
    status.className = "status off";
    status.textContent = "No webhook set — notifications are off.";
    $("hookUrl").placeholder = "https://discord.com/api/webhooks/…";
  }
}

$("hook").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("hookUrl").value.trim();
  if (!url) return;
  $("hookBtn").disabled = true;
  try {
    const res = await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discordWebhookUrl: url }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("Webhook saved.", "ok"); $("hookUrl").value = ""; loadSettings(); }
    else setMsg(data.error || "Failed to save webhook.", "err");
  } catch (err) {
    setMsg("Network error.", "err");
  } finally {
    $("hookBtn").disabled = false;
  }
};

$("hookClear").onclick = async () => {
  if (!confirm("Clear the Discord webhook? Notifications will stop.")) return;
  await fetch("/api/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discordWebhookUrl: "" }),
  });
  setMsg("Webhook cleared.", "ok");
  loadSettings();
};

$("add").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  if (!url) return;
  const webhookUrl = $("addHook").value.trim();
  $("addBtn").disabled = true;
  setMsg("Adding…");
  try {
    const res = await fetch("/api/playlists", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, webhookUrl }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg("Added " + (data.playlist?.name || "playlist") + ".", "ok");
      $("url").value = "";
      $("addHook").value = "";
      load();
    } else {
      setMsg(data.error || "Failed to add playlist.", "err");
    }
  } catch (err) {
    setMsg("Network error.", "err");
  } finally {
    $("addBtn").disabled = false;
  }
};

load();
loadSettings();
setInterval(load, 30000);
</script>
</body>
</html>`;
