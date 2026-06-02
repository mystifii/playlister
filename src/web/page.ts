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
</style>
</head>
<body>
<div class="wrap">
  <header><span class="dot"></span><h1>Playlister</h1></header>
  <p class="sub">Watching Apple Music playlists &middot; new songs are posted to Discord.</p>

  <form id="add">
    <input id="url" type="text" placeholder="Paste an Apple Music playlist share link…" autocomplete="off" />
    <button id="addBtn" type="submit">Add</button>
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
  const { playlists } = await res.json();
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
    const key = p.id || p.url;
    return (
      "<li>" +
        '<div class="meta">' +
          '<div class="name">' + nameHtml + "</div>" +
          '<div class="detail">' + count + fmtTime(p.lastChecked) + "</div>" +
        "</div>" +
        '<button class="ghost" data-id="' + esc(p.id || "") + '" data-url="' +
          esc(p.url) + '">Remove</button>' +
      "</li>"
    );
  }).join("");

  list.querySelectorAll("button[data-url]").forEach((btn) => {
    btn.onclick = () => remove(btn.dataset.id, btn.dataset.url);
  });
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

$("add").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  if (!url) return;
  $("addBtn").disabled = true;
  setMsg("Adding…");
  try {
    const res = await fetch("/api/playlists", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg("Added " + (data.playlist?.name || "playlist") + ".", "ok");
      $("url").value = "";
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
setInterval(load, 30000);
</script>
</body>
</html>`;
