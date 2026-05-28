(() => {
  const meta = window.BACKUP_META || {};
  const stats = window.BACKUP_STATS || {};
  const permissions = window.BACKUP_PERMISSIONS || { categories: [], channels: [] };
  const userData = window.BACKUP_USERS || { users: [], nameToId: {} };
  window.__BACKUP_CHUNKS__ = window.__BACKUP_CHUNKS__ || {};

  const els = {
    serverName: document.getElementById("server-name"),
    serverInfo: document.getElementById("server-info"),
    channelList: document.getElementById("channel-list"),
    search: document.getElementById("search"),
    title: document.getElementById("active-title"),
    activeMeta: document.getElementById("active-meta"),
    status: document.getElementById("status"),
    scroller: document.getElementById("message-scroller"),
    messages: document.getElementById("message-list"),
    newest: document.getElementById("newest"),
    older: document.getElementById("older"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  };

  const state = { channelId: null, channel: null, firstChunk: 0, lastChunk: -1, loading: false, token: 0, loadedScripts: new Set() };
  const channelsById = new Map((meta.channels || []).map(c => [String(c.id), c]));
  const usersById = new Map((userData.users || []).map(u => [String(u.id), u]));
  const nameToId = new Map(Object.entries(userData.nameToId || {}).map(([k,v]) => [String(k).toLowerCase(), String(v)]));
  const permChannels = new Map((permissions.channels || []).map(x => [String(x.id), x]));
  const permCategories = new Map((permissions.categories || []).map(x => [String(x.id), x]));
  const fmt = new Intl.NumberFormat("en-US");

  function updateDeviceClass() {
    const mobile = window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
    document.documentElement.classList.toggle("is-mobile", mobile);
    document.documentElement.classList.toggle("is-desktop", !mobile);
  }
  updateDeviceClass();
  window.addEventListener("resize", updateDeviceClass, { passive: true });
  window.matchMedia?.("(max-width: 820px)").addEventListener?.("change", updateDeviceClass);
  function closeMobileSidebar() {
    document.documentElement.classList.remove("sidebar-open");
    els.sidebarToggle?.setAttribute("aria-expanded", "false");
  }
  function openMobileSidebar() {
    document.documentElement.classList.add("sidebar-open");
    els.sidebarToggle?.setAttribute("aria-expanded", "true");
  }
  function toggleMobileSidebar() {
    if (document.documentElement.classList.contains("sidebar-open")) closeMobileSidebar();
    else openMobileSidebar();
  }
  els.sidebarToggle?.addEventListener("click", toggleMobileSidebar);
  els.sidebarBackdrop?.addEventListener("click", closeMobileSidebar);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMobileSidebar(); });

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function number(value) { return fmt.format(Number(value || 0)); }
  function pad(num) { return String(num).padStart(4, "0"); }
  function setStatus(text) { if (els.status) els.status.textContent = text || ""; }
  function percent(value, max) { return max ? Math.max(2, Math.min(100, (Number(value || 0) / Number(max || 1)) * 100)) : 0; }
  function formatDate(value) { if (!value) return "Not saved"; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("en-US", { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" }); }
  function formatMonth(month) { if (!/^\d{4}-\d{2}$/.test(String(month))) return month; const d = new Date(`${month}-01T00:00:00`); return d.toLocaleDateString("en-US", { month:"short", year:"2-digit" }); }
  function chunkKey(channelId, idx) { return `${channelId}:${idx}`; }
  function chunkPath(channelId, idx) { return `data/channels/${encodeURIComponent(channelId)}/chunk_${pad(idx)}.js`; }
  function cleanMediaPath(url) {
    const raw = String(url || "");
    try {
      const u = new URL(raw, location.href);
      return decodeURIComponent(u.pathname || raw).toLowerCase();
    } catch {
      try { return decodeURIComponent(raw.split("?")[0].split("#")[0]).toLowerCase(); }
      catch { return raw.split("?")[0].split("#")[0].toLowerCase(); }
    }
  }
  function mediaKind(url) {
    const raw = String(url || "");
    const lower = raw.toLowerCase();
    const clean = cleanMediaPath(raw);
    if (getYouTubeId(raw)) return "youtube";
    if (/\.gif$/i.test(clean) || /\.gifv$/i.test(clean) || /(media\.|c\.)?tenor\.com\//i.test(lower) && /\.gif/i.test(lower) || /media\d?\.giphy\.com\//i.test(lower)) return "gif";
    if (/tenor\.com\/view\//i.test(lower) || /giphy\.com\/gifs\//i.test(lower) || /klipy\.com\/gifs\//i.test(lower)) return "gif";
    if (/\.(png|jpe?g|webp|avif|bmp|svg)$/i.test(clean)) return "image";
    if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(clean)) return "video";
    if (/\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|aiff?|wma)$/i.test(clean)) return "audio";
    return "";
  }
  function mediaMime(url, kind) {
    const clean = cleanMediaPath(url);
    if (/\.mp4$|\.m4v$/i.test(clean)) return "video/mp4";
    if (/\.webm$/i.test(clean)) return "video/webm";
    if (/\.ogv$/i.test(clean)) return "video/ogg";
    if (/\.mov$/i.test(clean)) return "video/quicktime";
    if (/\.mp3$/i.test(clean)) return "audio/mpeg";
    if (/\.m4a$|\.aac$/i.test(clean)) return "audio/mp4";
    if (/\.ogg$|\.oga$|\.opus$/i.test(clean)) return "audio/ogg";
    if (/\.wav$/i.test(clean)) return "audio/wav";
    if (/\.flac$/i.test(clean)) return "audio/flac";
    if (/\.weba$/i.test(clean)) return "audio/webm";
    return kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "application/octet-stream";
  }
  function isLikelyBrowserUnsupported(url) {
    const clean = cleanMediaPath(url);
    return /\.(mov|wma|aiff?|flac)$/i.test(clean);
  }
  function normalizeImageUrl(src) {
    const value = String(src || "");
    if (!value) return value;
    if (/cdn\.discordapp\.com\/avatars\//i.test(value) || /cdn\.discordapp\.com\/icons\//i.test(value)) {
      return value.replace(/([?&])size=\d+/i, "$1size=1024");
    }
    return value;
  }
  function getYouTubeId(url) {
    try {
      const u = new URL(String(url || ""));
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      let id = "";
      if (host === "youtu.be") id = u.pathname.split("/").filter(Boolean)[0] || "";
      if (host.endsWith("youtube.com")) {
        if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
        else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2] || "";
        else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2] || "";
        else if (u.pathname.startsWith("/live/")) id = u.pathname.split("/")[2] || "";
      }
      if (host.endsWith("youtube-nocookie.com") && u.pathname.startsWith("/embed/")) {
        id = u.pathname.split("/")[2] || "";
      }
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : "";
    } catch { return ""; }
  }
  function parseYouTubeStart(value) {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Number(raw);
    const match = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (!match || !match[0]) return 0;
    return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
  }
  function getYouTubeEmbed(url) {
    const id = getYouTubeId(url);
    if (!id) return "";
    let start = 0;
    try {
      const u = new URL(String(url || ""));
      start = parseYouTubeStart(u.searchParams.get("start") || u.searchParams.get("t") || "");
    } catch {}
    const params = new URLSearchParams({ rel: "0", playsinline: "1" });
    if (start > 0) params.set("start", String(start));
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }

  function youtubeFrameHtml(embed, url) {
    if (!embed) {
      return `<a class="youtube-open" href="${escapeHtml(url || embed)}" target="_blank" rel="noreferrer">Open YouTube video</a>`;
    }
    return `<div class="video-frame active youtube-frame"><iframe src="${escapeHtml(embed)}" title="YouTube video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><div class="media-fallback youtube-fallback"><a href="${escapeHtml(url || embed)}" target="_blank" rel="noreferrer">Open on YouTube</a></div>`;
  }

  function getGifEmbed(url) {
    try {
      const u = new URL(String(url || ""));
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      const path = u.pathname;
      if (host.endsWith("tenor.com") && path.startsWith("/view/")) {
        const last = path.split("/").filter(Boolean).pop() || "";
        const id = (last.match(/-(\d{5,})$/) || [])[1];
        return id ? `https://tenor.com/embed/${id}` : "";
      }
      if (host.endsWith("giphy.com") && path.startsWith("/gifs/")) {
        const last = path.split("/").filter(Boolean).pop() || "";
        const id = last.split("-").pop();
        return /^[A-Za-z0-9]+$/.test(id) ? `https://giphy.com/embed/${id}` : "";
      }
      return "";
    } catch { return ""; }
  }

  function extractGiphyId(url) {
    try {
      const u = new URL(String(url || ""));
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1] || "";
      const id = last.split("-").pop();
      return /^[A-Za-z0-9]+$/.test(id || "") ? id : "";
    } catch { return ""; }
  }
  function inferTenorGifFromThumb(src) {
    const value = String(src || "");
    const m = value.match(/https?:\/\/media\.tenor\.com\/([^/]+)AAAA[a-zA-Z]?\/([^/?#]+)\.(?:png|jpg|jpeg|webp|gif)/i);
    if (!m) return "";
    return `https://media.tenor.com/${m[1]}AAAAC/${m[2]}.gif`;
  }
  function inferGifSource(url, context) {
    const raw = String(url || "");
    const lower = raw.toLowerCase();
    const clean = raw.split("?")[0].split("#")[0];
    if (/\.gif$/i.test(clean) || /media\d?\.giphy\.com\/.*\.gif/i.test(raw) || /media\.tenor\.com\/.*\.gif/i.test(raw)) return raw;
    if (/giphy\.com\/gifs\//i.test(lower)) {
      const id = extractGiphyId(raw);
      if (id) return `https://media.giphy.com/media/${id}/giphy.gif`;
    }
    const scope = context || document;
    const existingVideo = scope.querySelector?.('video.gif-video[src], video.embed-video[src], video[src]');
    const existingVideoSrc = existingVideo?.getAttribute("src") || "";
    if (existingVideoSrc) return existingVideoSrc;
    const thumb = scope.querySelector?.('img.embed-thumb[src*="media.tenor.com"], img.embed-image[src*="media.tenor.com"], img[src*="media.tenor.com"]');
    const tenorGif = inferTenorGifFromThumb(thumb?.getAttribute("src") || "");
    if (tenorGif) return tenorGif;
    const giphyThumb = scope.querySelector?.('img.embed-thumb[src*="giphy.com"], img.embed-image[src*="giphy.com"], img[src*="giphy.com"]');
    const giphySrc = giphyThumb?.getAttribute("src") || "";
    const giphyMatch = giphySrc.match(/\/media\/(?:v1\.[^/]+\/)?([A-Za-z0-9]+)\/giphy(?:_s)?\.gif/i);
    if (giphyMatch) return `https://media.giphy.com/media/${giphyMatch[1]}/giphy.gif`;
    const genericPreview = scope.querySelector?.('img.embed-image[src], img.embed-thumb[src], img[src*="klipy"], img[src*="tenor"], img[src*="giphy"]');
    const genericSrc = genericPreview?.getAttribute("src") || "";
    if (genericSrc) return genericSrc;
    return "";
  }
  function pruneDuplicateGifEmbeds(message) {
    if (!message) return;
    message.querySelectorAll(".embeds .embed").forEach(embed => {
      const hasOnlyPreview = !!embed.querySelector("img.embed-thumb, img.embed-image") && !embed.querySelector(".embed-title,.embed-description,.embed-field,.embed-footer");
      if (hasOnlyPreview) embed.remove();
    });
    message.querySelectorAll(".embeds").forEach(box => {
      if (!box.textContent.trim() && !box.querySelector(".embed")) box.remove();
    });
  }

  function mediaLabelFromUrl(url) {
    try { return decodeURIComponent((new URL(url)).pathname.split("/").filter(Boolean).pop() || "media"); }
    catch { return "media"; }
  }

  function loadScript(src, key) {
    return new Promise((resolve, reject) => {
      if (state.loadedScripts.has(key)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => { state.loadedScripts.add(key); resolve(); };
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
  }
  async function loadChunk(channelId, idx) {
    const key = chunkKey(channelId, idx);
    if (window.__BACKUP_CHUNKS__[key] !== undefined) return window.__BACKUP_CHUNKS__[key];
    await loadScript(chunkPath(channelId, idx), key);
    return window.__BACKUP_CHUNKS__[key] || "";
  }

  function findPermission(type, id) { return type === "category" ? permCategories.get(String(id)) : permChannels.get(String(id)); }
  function permissionSummary(item) { if (!item) return "No permission data saved."; const ow = item.overwrites || []; return `${ow.length} overwrite${ow.length === 1 ? "" : "s"}`; }
  function renderPermissions(item) {
    if (!item) return `<div class="modal-empty">No permission data saved for this item.</div>`;
    const rows = (item.overwrites || []).map(ow => `<tr><td>${escapeHtml(ow.targetName || ow.id)}</td><td>${escapeHtml(ow.targetType || "")}</td><td>${escapeHtml((ow.allow || []).join(", ") || "-")}</td><td>${escapeHtml((ow.deny || []).join(", ") || "-")}</td></tr>`).join("");
    return `<div class="permission-popup"><p><b>${escapeHtml(item.name || item.id)}</b><br><span>${escapeHtml(item.type || "")}${item.permissionsSynced === true ? " · synced" : item.permissionsSynced === false ? " · not synced" : ""}</span></p><table><thead><tr><th>Target</th><th>Type</th><th>Allowed</th><th>Denied</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No overwrites saved.</td></tr>`}</tbody></table></div>`;
  }

  function closeContextMenu() {
    document.querySelector(".context-menu")?.remove();
  }
  function copyText(value) {
    try { navigator.clipboard?.writeText(String(value || "")); setStatus("Copied to clipboard"); }
    catch { setStatus("Could not copy to clipboard"); }
  }
  function openPermissionItem(type, id) {
    const item = findPermission(type, id);
    openModal(`${type === "category" ? "Category" : "Channel"} Permissions`, renderPermissions(item));
  }
  function openContextMenu(event, type, id, label) {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    const item = findPermission(type, id);
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 180)}px`;
    menu.innerHTML = `<div class="context-menu-title">${escapeHtml(label || item?.name || id)}</div>
      <button type="button" data-action="permissions">View permissions</button>
      <button type="button" data-action="copy-id">Copy ID</button>`;
    menu.addEventListener("click", e => {
      const action = e.target.closest("button")?.dataset.action;
      if (!action) return;
      closeContextMenu();
      if (action === "permissions") openPermissionItem(type, id);
      if (action === "copy-id") copyText(id);
    });
    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener("click", closeContextMenu, { once:true });
      document.addEventListener("scroll", closeContextMenu, { once:true, capture:true });
    }, 0);
  }

  function openModal(title, bodyHtml, extraClass = "") {
    closeModal();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card ${escapeHtml(extraClass)}"><button class="modal-close" aria-label="Close">×</button><h3>${escapeHtml(title)}</h3><div class="modal-body">${bodyHtml}</div></div>`;
    overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
    overlay.querySelector(".modal-close")?.addEventListener("click", closeModal);
    document.body.appendChild(overlay);
  }
  function closeModal() { document.querySelector(".modal-overlay")?.remove(); }

  function openImage(src, alt) {
    const fullSrc = normalizeImageUrl(src);
    openModal(alt || "Media preview", `<div class="lightbox large"><img src="${escapeHtml(fullSrc)}" alt="${escapeHtml(alt || "")}"></div><div class="lightbox-actions"><a href="${escapeHtml(fullSrc)}" target="_blank" rel="noreferrer">Open original</a></div>`, "media-modal");
  }

  function accountCreatedFromSnowflake(id) {
    try { return new Date((BigInt(id) >> 22n) + 1420070400000n).toISOString(); } catch { return null; }
  }
  function getUser(id, fallbackName, avatar) {
    const u = usersById.get(String(id)) || {};
    return {
      id: String(id || u.id || "Unknown"),
      username: u.username || fallbackName || "Unknown user",
      displayName: u.displayName || fallbackName || u.username || "Unknown user",
      avatarUrl: u.avatarUrl || avatar || "",
      isBot: !!u.isBot,
      messageCount: u.messageCount || 0,
      createdAt: u.createdAt || accountCreatedFromSnowflake(id),
      joinedAt: u.joinedAt || null,
      firstMessageAt: u.firstMessageAt,
      lastMessageAt: u.lastMessageAt,
      roles: Array.isArray(u.roles) ? u.roles : [],
    };
  }
  function renderUserRoles(user) {
    const roles = Array.isArray(user.roles) ? [...user.roles].sort((a,b) => Number(b.position || 0) - Number(a.position || 0)) : [];
    if (!roles.length) return `<div class="profile-roles empty">No saved roles</div>`;
    return `<div class="profile-roles">${roles.map(role => {
      const color = /^#[0-9a-f]{6}$/i.test(String(role.color || "")) ? ` style="--role-color:${escapeHtml(role.color)}"` : "";
      return `<span class="role-chip"${color}>${escapeHtml(role.name || role.id)}</span>`;
    }).join("")}</div>`;
  }

  function openUserPopup(user) {
    const avatar = user.avatarUrl ? `<img class="profile-avatar" src="${escapeHtml(user.avatarUrl)}" alt="avatar">` : `<div class="profile-avatar empty">?</div>`;
    openModal(user.displayName || user.username || "User", `<div class="profile-card">${avatar}<div class="profile-info"><h4>${escapeHtml(user.displayName || user.username)}</h4>${user.isBot ? `<span class="bot-pill">BOT</span>` : ""}<dl><dt>User ID</dt><dd>${escapeHtml(user.id)}</dd><dt>Username</dt><dd>${escapeHtml(user.username || "Unknown")}</dd><dt>Account created</dt><dd>${formatDate(user.createdAt)}</dd><dt>Server joined</dt><dd>${formatDate(user.joinedAt)}</dd><dt>First saved message</dt><dd>${formatDate(user.firstMessageAt)}</dd><dt>Last saved message</dt><dd>${formatDate(user.lastMessageAt)}</dd><dt>Saved messages</dt><dd>${number(user.messageCount)}</dd><dt>Roles</dt><dd>${renderUserRoles(user)}</dd></dl></div></div>`);
  }

  function buildSidebar() {
    els.serverName.textContent = meta.serverName || "Discord Backup";
    els.serverInfo.innerHTML = meta.serverInfoHtml || `Offline viewer<br>${number(meta.totalMessages || 0)} messages`;
    const frag = document.createDocumentFragment();
    const overviewWrap = document.createElement("div");
    overviewWrap.className = "overview-nav";
    const overview = document.createElement("button");
    overview.id = "overview-button";
    overview.className = "channel-button overview-button";
    overview.innerHTML = `<span class="channel-name">▣ Server Statistics</span><span class="channel-count">${number(stats?.totals?.messages || meta.totalMessages || 0)}</span>`;
    overview.addEventListener("click", () => { showStats(); closeMobileSidebar(); });
    frag.appendChild(overviewWrap);
    overviewWrap.appendChild(overview);

    for (const cat of (meta.categories || [])) {
      const block = document.createElement("div");
      block.className = "category-block";
      block.dataset.categoryId = cat.id;
      const btn = document.createElement("button");
      btn.className = "category-button";
      btn.title = "Left-click to collapse. Right-click to view permissions.";
      btn.innerHTML = `<span class="category-arrow">⌄</span><span class="category-title">${escapeHtml(cat.name)}</span><span class="channel-count">${escapeHtml(cat.countLabel || "")}</span>`;
      btn.addEventListener("click", () => block.classList.toggle("collapsed"));
      btn.addEventListener("contextmenu", e => openContextMenu(e, "category", cat.id, cat.name));
      block.appendChild(btn);
      const list = document.createElement("div");
      list.className = "category-channels";
      for (const channelId of (cat.channels || [])) {
        const ch = channelsById.get(String(channelId));
        if (!ch) continue;
        const cbtn = document.createElement("button");
        cbtn.className = "channel-button";
        cbtn.dataset.channelId = ch.id;
        cbtn.title = "Left-click to open. Right-click to view permissions.";
        cbtn.innerHTML = `<span class="channel-name">${escapeHtml(ch.name)}</span><span class="channel-count">${number(ch.messageCount || 0)}</span>`;
        cbtn.addEventListener("click", () => { activateChannel(ch.id); closeMobileSidebar(); });
        cbtn.addEventListener("contextmenu", e => openContextMenu(e, "channel", ch.id, ch.name));
        list.appendChild(cbtn);
      }
      block.appendChild(list);
      frag.appendChild(block);
    }
    els.channelList.replaceChildren(frag);
  }
  function setActiveButton(id) {
    document.getElementById("overview-button")?.classList.toggle("active", id === "stats");
    document.querySelectorAll(".channel-button[data-channel-id]").forEach(b => b.classList.toggle("active", b.dataset.channelId === String(id)));
  }
  function setChannelToolbar(enabled) { if (els.older) els.older.disabled = !enabled; if (els.newest) els.newest.disabled = !enabled; }
  function updateMetaLine() { const ch = state.channel; if (!ch) return; const loaded = state.lastChunk >= state.firstChunk ? (state.lastChunk - state.firstChunk + 1) : 0; els.activeMeta.textContent = `${number(ch.messageCount || 0)} messages · ${loaded}/${ch.chunkCount || 0} chunks loaded`; }

  function metricCard(label, value, hint, accent) { return `<article class="stat-card ${accent || ""}"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div>${hint ? `<div class="stat-hint">${escapeHtml(hint)}</div>` : ""}</article>`; }
  function barRows(items, options = {}) {
    const labelKey = options.labelKey || "name", valueKey = options.valueKey || "messageCount";
    const max = Math.max(...items.map(x => Number(x[valueKey] || 0)), 1);
    return items.map((item, idx) => {
      const label = typeof labelKey === "function" ? labelKey(item) : item[labelKey];
      const sub = options.sub ? options.sub(item) : "";
      const jump = options.channelLink && item.id ? ` data-jump-channel="${escapeHtml(item.id)}"` : "";
      return `<div class="bar-row"${jump}><div class="bar-rank">${idx + 1}</div><div class="bar-main"><div class="bar-label"><span>${escapeHtml(label)}</span>${sub ? `<em>${escapeHtml(sub)}</em>` : ""}</div><div class="bar-track"><div class="bar-fill" style="width:${percent(item[valueKey], max)}%"></div></div></div><div class="bar-value">${number(item[valueKey])}</div></div>`;
    }).join("");
  }
  function miniBars(items, labelKey, valueKey) { const max = Math.max(...items.map(x => Number(x[valueKey] || 0)), 1); return `<div class="mini-bars">${items.map(item => `<div class="mini-bar" title="${escapeHtml(item[labelKey])}: ${number(item[valueKey])}"><div class="mini-bar-fill" style="height:${percent(item[valueKey], max)}%"></div><span>${escapeHtml(item[labelKey])}</span></div>`).join("")}</div>`; }
  function monthTimeline(items) { const max = Math.max(...items.map(x => Number(x.messageCount || 0)), 1); return `<div class="timeline-bars">${items.map(item => `<div class="timeline-item" title="${escapeHtml(formatMonth(item.month))}: ${number(item.messageCount)} messages"><div class="timeline-fill" style="height:${percent(item.messageCount, max)}%"></div><span>${escapeHtml(formatMonth(item.month))}</span></div>`).join("")}</div>`; }
  function channelTable(items) { return `<div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>#</th><th>Channel</th><th>Category</th><th>Messages</th><th>Chunks</th><th>Permissions</th></tr></thead><tbody>${items.map((ch, idx) => `<tr data-jump-channel="${escapeHtml(ch.id)}"><td>${idx + 1}</td><td>${escapeHtml(ch.name)}</td><td>${escapeHtml(ch.categoryName || "-")}</td><td>${number(ch.messageCount)}</td><td>${number(ch.chunkCount)}</td><td>${escapeHtml(permissionSummary(permChannels.get(String(ch.id))))}</td></tr>`).join("")}</tbody></table></div>`; }

  function renderReaction(r) { return r.isHtml || /^<img\s/i.test(String(r.emoji || "")) ? r.emoji : escapeHtml(r.emoji || ""); }
  function renderStats() {
    const t = stats.totals || {}, p = stats.permissions || {};
    const topChannel = (stats.topChannels || [])[0], topUser = (stats.topUsers || [])[0];
    const months = (stats.months || []).slice(-36), channels = stats.topChannels || [], categories = stats.categories || [], users = stats.topUsers || [], reactions = stats.topReactions || [];
    const spanText = t.firstMessageAt && t.lastMessageAt ? `${formatDate(t.firstMessageAt)} → ${formatDate(t.lastMessageAt)}` : "-";
    const mediaItems = [
      { label:"Attachments", value:t.attachments }, { label:"Images", value:t.imageAttachments }, { label:"Embeds", value:t.embeds }, { label:"Stickers", value:t.stickers },
      { label:"Reaction pills", value:t.reactions }, { label:"Reaction clicks", value:t.reactionClicks }, { label:"Mentions", value:t.mentions }, { label:"Custom emojis", value:t.customEmojiImages },
      { label:"Spoilers", value:t.spoilers }, { label:"Bot messages", value:t.botMessages }
    ];
    return `<section class="stats-dashboard"><div class="stats-hero"><div><div class="eyebrow">Offline Discord Archive</div><h1>${escapeHtml(stats?.server?.name || meta.serverName || "Server")} Statistics</h1><p>This start page summarizes the saved Discord backup. Channels are chunk-loaded so large history stays usable instead of freezing the browser.</p><button class="stats-png-button" id="download-stats-png" type="button">Download statistics as PNG</button></div><div class="hero-logo-card"><img src="${escapeHtml(meta.serverIconUrl || "")}" alt="Server logo"><b>${escapeHtml(meta.serverName || "Server")}</b><small>${escapeHtml(stats.generatedAt || meta.generatedAt || "")}</small></div></div>
    <div class="stat-grid">${metricCard("Messages", number(t.messages), "Saved messages", "hot")}${metricCard("Human authors", number(t.uniqueAuthors), "Bots hidden from author ranking")}${metricCard("Channels", number(t.channels), `${number(t.categories)} categories`)}${metricCard("Chunks", number(t.chunks), "Loaded only when needed")}${metricCard("Attachments", number(t.attachments), `${number(t.imageAttachments)} images`)}${metricCard("Embeds", number(t.embeds), "Discord, link and bot embeds")}${metricCard("Stickers", number(t.stickers), "Saved sticker elements")}${metricCard("Reactions", number(t.reactionClicks), `${number(t.reactions)} reaction pills`)}</div>
    <div class="insight-grid"><article class="insight-card"><span>Top Channel</span><b>${escapeHtml(topChannel?.name || "-")}</b><p>${number(topChannel?.messageCount)} messages</p></article><article class="insight-card"><span>Top Human Author</span><b>${escapeHtml(topUser?.name || "-")}</b><p>${number(topUser?.messageCount)} messages</p></article><article class="insight-card"><span>Backup Range</span><b>${escapeHtml(spanText)}</b><p>Oldest to newest saved message</p></article><article class="insight-card"><span>Permissions</span><b>${number(p.overwritesSaved)} overwrites</b><p>${number(p.privateChannels)} private channels detected</p></article></div>
    <div class="stats-section wide"><div class="section-head"><h2>Activity over time</h2><p>The last ${number(months.length)} months saved in this backup.</p></div>${monthTimeline(months)}</div>
    <div class="stats-columns"><div class="stats-section"><div class="section-head"><h2>Top Channels</h2><p>Click a channel to open it.</p></div>${barRows(channels.slice(0, 12), { channelLink:true, sub:item => item.categoryName || "-" })}</div><div class="stats-section"><div class="section-head"><h2>Top Human Authors</h2><p>Bots are intentionally excluded here.</p></div>${barRows(users.slice(0, 12), { labelKey:"name" })}</div></div>
    <div class="stats-columns compact"><div class="stats-section"><div class="section-head"><h2>Categories</h2><p>Message distribution by category.</p></div>${barRows(categories.slice(0, 12), { sub:item => `${number(item.channelCount)} channels · ${number(item.nonEmptyChannels)} active` })}</div><div class="stats-section"><div class="section-head"><h2>Weekdays</h2><p>Which days were most active.</p></div>${barRows((stats.weekdays || []).map(x => ({ name:x.weekday, messageCount:x.messageCount })))}</div></div>
    <div class="stats-section wide"><div class="section-head"><h2>Hours</h2><p>Message distribution over 24 hours.</p></div>${miniBars((stats.hours || []).map(x => ({ hour:String(x.hour).replace(":00", ""), messageCount:x.messageCount })), "hour", "messageCount")}</div>
    <div class="stats-columns compact"><div class="stats-section"><div class="section-head"><h2>Media & Formatting</h2><p>Visual elements saved in the archive.</p></div><div class="media-grid">${mediaItems.map(item => `<div><span>${escapeHtml(item.label)}</span><b>${number(item.value)}</b></div>`).join("")}</div></div><div class="stats-section"><div class="section-head"><h2>Top Reactions</h2><p>Actual emoji reactions, not placeholders.</p></div><div class="reaction-cloud">${reactions.slice(0, 24).map(r => `<span><i>${renderReaction(r)}</i><b>${number(r.count)}</b></span>`).join("") || `<em class="muted">No reactions found.</em>`}</div></div></div>
    <div class="stats-section wide"><div class="section-head"><h2>Saved Permissions</h2><p>Category and channel permission overwrites are available through the small gear icons in the sidebar.</p></div><div class="permission-summary-grid">${metricCard("Categories", number(p.categoriesSaved), "with permission data")}${metricCard("Channels", number(p.channelsSaved), "with permission data")}${metricCard("Overwrites", number(p.overwritesSaved), "allow/deny rules")}${metricCard("Private Channels", number(p.privateChannels), "@everyone ViewChannel denied")}</div></div>
    <div class="stats-section wide"><div class="section-head"><h2>Channel Table</h2><p>Top 30 channels by saved messages.</p></div>${channelTable((stats.allChannels || []).slice(0, 30))}</div></section>`;
  }

  function wireStatsLinks() { els.messages.querySelectorAll("[data-jump-channel]").forEach(el => el.addEventListener("click", () => activateChannel(el.getAttribute("data-jump-channel")))); }
  function blobToDataUrl(blob) { return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => resolve(""); reader.readAsDataURL(blob); }); }
  async function inlineImagesForExport(root) {
    const imgs = [...root.querySelectorAll("img")];
    await Promise.all(imgs.map(async img => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) return;
      try {
        const res = await fetch(normalizeImageUrl(src), { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await blobToDataUrl(await res.blob());
        if (data) img.setAttribute("src", data); else img.removeAttribute("src");
      } catch { img.removeAttribute("src"); img.classList.add("export-image-missing"); }
    }));
  }
  function reactionTextForCanvas(reaction) {
    const raw = String(reaction?.label || reaction?.emoji || "reaction");
    const alt = raw.match(/alt="([^"]+)"/i)?.[1];
    if (alt) return `:${alt}:`;
    return raw.replace(/<[^>]+>/g, "").trim() || "reaction";
  }
  function downloadStatsPng() {
    const button = document.getElementById("download-stats-png");
    const oldText = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "Creating PNG..."; }
    setStatus("Creating clean statistics PNG...");
    try {
      const t = stats.totals || {};
      const p = stats.permissions || {};
      const topChannels = (stats.topChannels || []).slice(0, 8);
      const topUsers = (stats.topUsers || []).slice(0, 8);
      const months = (stats.months || []).slice(-14);
      const reactions = (stats.topReactions || []).slice(0, 10);

      const width = 1800;
      const height = 2400;
      const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 2));
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);

      function rr(x,y,w,h,r) {
        ctx.beginPath();
        ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
      }
      function fillRound(x,y,w,h,r,fill,stroke) {
        rr(x,y,w,h,r); ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; rr(x,y,w,h,r); ctx.stroke(); }
      }
      function write(value,x,y,size=28,color="#dbdee1",weight=600,align="left") {
        ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
        ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "top";
        ctx.fillText(String(value ?? ""), x, y);
      }
      function truncate(value, max=34) {
        const s = String(value ?? "");
        return s.length > max ? s.slice(0, max - 1) + "…" : s;
      }
      function metricCard(x,y,w,h,label,value,hint) {
        fillRound(x,y,w,h,24,"#2b2d31","#404249");
        write(label.toUpperCase(), x+26, y+22, 18, "#949ba4", 800);
        write(value, x+26, y+58, 44, "#ffffff", 900);
        write(hint || "", x+26, y+116, 20, "#b5bac1", 600);
      }
      function listCard(x,y,w,h,title,items,labelFn,valueFn) {
        fillRound(x,y,w,h,24,"#2b2d31","#404249");
        write(title, x+28, y+24, 32, "#ffffff", 900);
        const max = Math.max(...items.map(valueFn), 1);
        let yy = y + 88;
        items.forEach((item,i) => {
          const val = Number(valueFn(item) || 0);
          write(`${i+1}. ${truncate(labelFn(item), 40)}`, x+28, yy, 23, "#f2f3f5", 800);
          write(number(val), x+w-28, yy, 23, "#b5bac1", 800, "right");
          fillRound(x+28, yy+38, w-56, 14, 8, "#1e1f22");
          fillRound(x+28, yy+38, Math.max(8, (w-56) * val / max), 14, 8, "#5865f2");
          yy += 70;
        });
      }
      function timelineCard(x,y,w,h) {
        fillRound(x,y,w,h,24,"#2b2d31","#404249");
        write("Activity over time", x+28, y+24, 34, "#ffffff", 900);
        write("Last saved months", x+28, y+64, 20, "#949ba4", 700);
        const max = Math.max(...months.map(m => Number(m.messageCount || 0)), 1);
        const gap = 14;
        const barW = (w - 72 - gap * (months.length - 1)) / Math.max(1, months.length);
        months.forEach((m,i) => {
          const val = Number(m.messageCount || 0);
          const bh = Math.max(8, (h-150) * val / max);
          const bx = x + 36 + i * (barW + gap);
          const by = y + h - 72 - bh;
          fillRound(bx, by, barW, bh, 10, "#5865f2");
          write(formatMonth(m.month), bx + barW/2, y+h-44, 16, "#b5bac1", 700, "center");
        });
      }

      const bg = ctx.createLinearGradient(0,0,width,height);
      bg.addColorStop(0,"#1e1f22"); bg.addColorStop(.55,"#2b2d31"); bg.addColorStop(1,"#313338");
      ctx.fillStyle = bg; ctx.fillRect(0,0,width,height);
      ctx.fillStyle = "rgba(88,101,242,.18)"; ctx.beginPath(); ctx.arc(250,160,260,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(35,165,89,.10)"; ctx.beginPath(); ctx.arc(1580,260,320,0,Math.PI*2); ctx.fill();

      write(stats?.server?.name || meta.serverName || "Discord Backup", 90, 78, 72, "#ffffff", 900);
      write("Offline Discord Backup · Server Statistics", 94, 168, 30, "#b5bac1", 700);
      write(`Generated: ${stats.generatedAt || meta.generatedAt || ""}`, 94, 210, 24, "#949ba4", 600);
      fillRound(1510, 76, 190, 190, 46, "#5865f2");
      write((meta.serverName || "LL").split(/\s+/).map(x => x[0]).join("").slice(0,2).toUpperCase() || "LL", 1605, 125, 72, "#fff", 900, "center");

      const x0=90, y0=330, gap=28, cardW=390, cardH=164;
      metricCard(x0, y0, cardW, cardH, "Messages", number(t.messages), "saved messages");
      metricCard(x0+(cardW+gap), y0, cardW, cardH, "Human authors", number(t.uniqueAuthors), "bots excluded");
      metricCard(x0+(cardW+gap)*2, y0, cardW, cardH, "Channels", number(t.channels), `${number(t.categories)} categories`);
      metricCard(x0+(cardW+gap)*3, y0, cardW, cardH, "Chunks", number(t.chunks), "loaded on demand");

      metricCard(x0, y0+cardH+gap, cardW, cardH, "Attachments", number(t.attachments), `${number(t.imageAttachments)} images`);
      metricCard(x0+(cardW+gap), y0+cardH+gap, cardW, cardH, "Embeds", number(t.embeds), "saved embed blocks");
      metricCard(x0+(cardW+gap)*2, y0+cardH+gap, cardW, cardH, "Stickers", number(t.stickers), "saved sticker elements");
      metricCard(x0+(cardW+gap)*3, y0+cardH+gap, cardW, cardH, "Reactions", number(t.reactionClicks), `${number(t.reactions)} reaction pills`);

      timelineCard(90, 760, 1620, 360);
      listCard(90, 1170, 780, 690, "Top Channels", topChannels, x => x.name || "-", x => Number(x.messageCount || 0));
      listCard(930, 1170, 780, 690, "Top Human Authors", topUsers, x => x.name || "-", x => Number(x.messageCount || 0));

      fillRound(90, 1910, 780, 330, 24, "#2b2d31", "#404249");
      write("Media & Permissions", 118, 1936, 32, "#fff", 900);
      [["Images",t.imageAttachments],["Attachments",t.attachments],["Custom emojis",t.customEmojiImages],["Permission overwrites",p.overwritesSaved],["Private channels",p.privateChannels]].forEach((row,i) => {
        write(row[0], 126, 2005 + i*42, 24, "#b5bac1", 800);
        write(number(row[1]), 820, 2005 + i*42, 24, "#fff", 900, "right");
      });

      fillRound(930, 1910, 780, 330, 24, "#2b2d31", "#404249");
      write("Top Reactions", 958, 1936, 32, "#fff", 900);
      reactions.slice(0,7).forEach((r,i) => {
        write(`${i+1}. ${truncate(reactionTextForCanvas(r), 26)}`, 966, 2002 + i*34, 24, "#f2f3f5", 800);
        write(number(r.count), 1660, 2002 + i*34, 24, "#fff", 900, "right");
      });

      write("Generated by the LinguaLounge offline backup viewer", 90, 2318, 24, "#949ba4", 700);

      canvas.toBlob(blob => {
        if (!blob) { setStatus("PNG export failed: canvas did not return a PNG"); if (button) { button.disabled = false; button.textContent = oldText; } return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(meta.serverName || "discord-backup").replace(/[^a-z0-9_-]+/gi, "_")}_statistics.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
        setStatus("Statistics PNG downloaded");
        if (button) { button.disabled = false; button.textContent = oldText; }
      }, "image/png");
    } catch (err) {
      setStatus(`PNG export failed: ${err.message}`);
      if (button) { button.disabled = false; button.textContent = oldText; }
    }
  }
  function showStats() { closeMobileSidebar(); state.token++; state.channelId = null; state.channel = null; state.loading = false; setChannelToolbar(false); setActiveButton("stats"); els.title.textContent = "Server Statistics"; els.activeMeta.textContent = `${number(stats?.totals?.messages || meta.totalMessages || 0)} messages · ${number(stats?.totals?.uniqueAuthors || 0)} human authors`; els.messages.innerHTML = renderStats(); els.scroller.scrollTop = 0; location.hash = "stats"; setStatus("Statistics overview loaded"); wireStatsLinks(); wireLazyVideoPlayers(els.messages); wireInteractiveMedia(els.messages); document.getElementById("download-stats-png")?.addEventListener("click", downloadStatsPng); }

  function replaceCustomEmojiTextNodes(root) {
    const rx = /<a?:([A-Za-z0-9_~.-]+):(\d{15,25})>/g;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) { return rx.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue || ""; rx.lastIndex = 0;
      const frag = document.createDocumentFragment(); let last = 0, m;
      while ((m = rx.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const img = document.createElement("img"); img.className = "emoji"; img.alt = `:${m[1]}:`; img.title = `:${m[1]}:`; img.loading = "lazy"; img.src = `https://cdn.discordapp.com/emojis/${m[2]}.${m[0].startsWith("<a:") ? "gif" : "png"}`; frag.appendChild(img); last = rx.lastIndex;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  function repairInlineCodeTokens(root) {
    root.querySelectorAll(".content,.embed-description,.embed-desc,.embed-field-value,.embed-field-name,.embed-title,.embed-footer,.embed-author").forEach(container => {
      if (container.dataset.inlineCodeRepaired) return;
      container.dataset.inlineCodeRepaired = "1";

      // Older exports accidentally let markdown parse @@HTML_BACKUP_TOKEN_N@@ into @@HTML<em>BACKUP</em>TOKEN_N@@.
      container.innerHTML = container.innerHTML
        .replace(/@@HTML(?:<em>)?BACKUP(?:<\/em>)?TOKEN_(\d+)@@/g, '<code class="inline-code missing-code" title="The old backup did not preserve this inline-code text">[code not preserved in old backup]</code>')
        .replace(/@@HTML_BACKUP_TOKEN_(\d+)@@/g, '<code class="inline-code missing-code" title="The old backup did not preserve this inline-code text">[code not preserved in old backup]</code>');

      const shouldProcess = /```|`[^`\n]+`|\*{1,3}[^*\n]+\*{1,3}|~~[^~\n]+~~|\|\|[\s\S]+?\|\|/;
      const tokenRx = /(```([\s\S]*?)```)|(`([^`\n]+)`)|(\*\*\*([^*\n]+)\*\*\*)|(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(~~([^~\n]+)~~)|(\|\|([\s\S]+?)\|\|)/g;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest("code,pre,a,.emoji,.reaction,.spoiler,strong,em,s")) return NodeFilter.FILTER_REJECT;
          return shouldProcess.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const value = node.nodeValue || "";
        const frag = document.createDocumentFragment();
        tokenRx.lastIndex = 0;
        let last = 0, match;
        while ((match = tokenRx.exec(value))) {
          if (match.index > last) frag.appendChild(document.createTextNode(value.slice(last, match.index)));
          if (match[2] !== undefined) {
            const pre = document.createElement("pre"); pre.className = "code-block";
            const code = document.createElement("code"); code.textContent = match[2]; pre.appendChild(code); frag.appendChild(pre);
          } else if (match[4] !== undefined) {
            const code = document.createElement("code"); code.className = "inline-code"; code.textContent = match[4]; frag.appendChild(code);
          } else if (match[6] !== undefined) {
            const strong = document.createElement("strong"); const em = document.createElement("em"); em.textContent = match[6]; strong.appendChild(em); frag.appendChild(strong);
          } else if (match[8] !== undefined) {
            const strong = document.createElement("strong"); strong.textContent = match[8]; frag.appendChild(strong);
          } else if (match[10] !== undefined) {
            const em = document.createElement("em"); em.textContent = match[10]; frag.appendChild(em);
          } else if (match[12] !== undefined) {
            const s = document.createElement("s"); s.textContent = match[12]; frag.appendChild(s);
          } else if (match[14] !== undefined) {
            const spoiler = document.createElement("span"); spoiler.className = "spoiler"; spoiler.textContent = match[14]; frag.appendChild(spoiler);
          }
          last = tokenRx.lastIndex;
        }
        if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    });
  }


  function applyDiscordLineFormatting(root) {
    root.querySelectorAll(".content,.embed-description,.embed-desc,.embed-field-value,.embed-field-name,.embed-title,.embed-footer").forEach(el => {
      if (el.dataset.lineFormatted) return;
      el.dataset.lineFormatted = "1";
      const lines = el.innerHTML.split(/<br\s*\/?\s*>/i);
      if (lines.length < 1) return;
      const out = lines.map(line => {
        const text = line.replace(/<[^>]+>/g, "").trim();
        if (/^#\s+/.test(text)) return `<div class="discord-heading">${line.replace(/^\s*#\s+/, "")}</div>`;
        if (/^-#\s+/.test(text)) return `<div class="discord-subtext">${line.replace(/^\s*-#\s+/, "")}</div>`;
        if (/^&gt;\s+/.test(line.trim()) || /^>\s+/.test(text)) return `<blockquote>${line.replace(/^\s*(?:&gt;|>)\s+/, "")}</blockquote>`;
        if (/^-\s+/.test(text)) return `<div class="discord-list-item"><span>•</span><div>${line.replace(/^\s*-\s+/, "")}</div></div>`;
        return line;
      });
      el.innerHTML = out.join("<br>");
    });
  }

  function mediaFallbackHtml(href, kind, label, extra = "") {
    const labelText = escapeHtml(label || mediaLabelFromUrl(href));
    const openText = kind === "audio" ? "Open audio" : kind === "video" ? "Open video" : "Open media";
    return `<div class="media-fallback ${extra}"><span>${labelText}</span><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${openText}</a></div>`;
  }

  function createMediaCard(href, kind, label, context) {
    const mediaWrap = document.createElement("div");
    mediaWrap.className = `inline-media media-player ${kind}`;
    const cleanLabel = escapeHtml(label || mediaLabelFromUrl(href));
    if (kind === "youtube") {
      const embed = getYouTubeEmbed(href);
      mediaWrap.classList.add("youtube-preview-card");
      mediaWrap.innerHTML = `<div class="youtube-discord-card"><span class="yt-provider">YouTube</span><span class="yt-title">${cleanLabel && cleanLabel !== mediaLabelFromUrl(href) ? cleanLabel : "YouTube video"}</span>${youtubeFrameHtml(embed, href)}</div>`;
    } else if (kind === "video") {
      const unsupportedNote = isLikelyBrowserUnsupported(href) ? mediaFallbackHtml(href, kind, label, "format-warning") : "";
      mediaWrap.innerHTML = `<video controls preload="metadata" playsinline><source src="${escapeHtml(href)}" type="${escapeHtml(mediaMime(href, kind))}"></video>${unsupportedNote}${mediaFallbackHtml(href, kind, label)}`;
    } else if (kind === "audio") {
      const unsupportedNote = isLikelyBrowserUnsupported(href) ? mediaFallbackHtml(href, kind, label, "format-warning") : "";
      mediaWrap.innerHTML = `<div class="audio-card"><audio controls preload="metadata"><source src="${escapeHtml(href)}" type="${escapeHtml(mediaMime(href, kind))}"></audio>${unsupportedNote}${mediaFallbackHtml(href, kind, label)}</div>`;
    } else if (kind === "gif") {
      const gifSrc = inferGifSource(href, context) || href;
      mediaWrap.classList.add("gif-only");
      const isVideoGif = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(gifSrc);
      mediaWrap.innerHTML = isVideoGif ? `<video class="gif-video" autoplay loop muted playsinline src="${escapeHtml(gifSrc)}"></video>` : `<img class="gif-media" src="${escapeHtml(gifSrc)}" alt="${cleanLabel}" loading="lazy">`;
      const msg = context?.closest?.("article.message") || context;
      pruneDuplicateGifEmbeds(msg);
    } else {
      mediaWrap.innerHTML = `<img src="${escapeHtml(href)}" alt="${cleanLabel}" loading="lazy">`;
    }
    return mediaWrap;
  }
  function stripTrailingUrlPunctuation(raw) {
    let url = String(raw || "");
    let tail = "";
    while (/[\].,!?;:)]$/.test(url) && !/\([^)]+\)$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0, -1); }
    return { url, tail };
  }

  function articleHasYouTubeEmbed(node) {
    return !!(node?.closest?.("article.message")?.querySelector?.(".embed.youtube-embed,.youtube-embed"));
  }

  function isInsideYouTubeEmbed(node) {
    return !!node?.closest?.(".embed.youtube-embed,.youtube-embed");
  }

  function shouldSkipYouTubeAutoCard(node) {
    if (!node) return false;
    if (isInsideYouTubeEmbed(node)) return true;
    if (node.closest?.(".embed,.embeds,.discord-reply-rich,.reply-reference,.message-reference,.replied-message")) return true;
    return articleHasYouTubeEmbed(node);
  }

  function enhanceMedia(root) {
    root.querySelectorAll("a[href]").forEach(a => {
      if (a.dataset.mediaEnhanced) return;
      const href = a.getAttribute("href") || "";
      const kind = mediaKind(href);
      if (!kind) return;
      a.dataset.mediaEnhanced = "1";
      if (kind === "youtube" && shouldSkipYouTubeAutoCard(a)) return;
      const hasVisibleImage = !!a.querySelector("img") && (kind === "image" || kind === "gif");
      if (a.classList.contains("attachment") && hasVisibleImage) return;
      const mediaWrap = createMediaCard(href, kind, a.textContent || a.getAttribute("title") || "media", a.closest("article.message") || a.closest(".embed") || root);
      if (a.classList.contains("attachment")) { a.replaceChildren(mediaWrap); a.classList.add("rich-media"); }
      else { a.replaceWith(mediaWrap); }
    });
  }
  function enhanceBareMediaText(root) {
    const urlRx = /https?:\/\/[^\s<>"']+/g;
    root.querySelectorAll(".content,.embed-description,.embed-desc,.embed-field-value,.embed-field-name,.embed-title,.embed-footer,.embed-author").forEach(container => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest("a,code,pre,.inline-media,.emoji,.reaction,.youtube-lite")) return NodeFilter.FILTER_REJECT;
          urlRx.lastIndex = 0;
          return urlRx.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const textValue = node.nodeValue || "";
        const frag = document.createDocumentFragment();
        urlRx.lastIndex = 0;
        let last = 0, match, changed = false;
        while ((match = urlRx.exec(textValue))) {
          const raw = match[0];
          const clean = stripTrailingUrlPunctuation(raw);
          const kind = mediaKind(clean.url);
          if (!kind) continue;
          if (kind === "youtube" && shouldSkipYouTubeAutoCard(container)) continue;
          changed = true;
          if (match.index > last) frag.appendChild(document.createTextNode(textValue.slice(last, match.index)));
          frag.appendChild(createMediaCard(clean.url, kind, mediaLabelFromUrl(clean.url), container.closest("article.message") || container.closest(".embed") || container));
          if (clean.tail) frag.appendChild(document.createTextNode(clean.tail));
          last = match.index + raw.length;
        }
        if (!changed) continue;
        if (last < textValue.length) frag.appendChild(document.createTextNode(textValue.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    });
  }
  function directMediaUrl(el) {
    const source = el.querySelector?.("source[src]");
    return source?.getAttribute("src") || el.getAttribute("src") || "";
  }

  function ensureSourceElement(el, kind) {
    if (el.querySelector("source[src]")) return;
    const src = el.getAttribute("src") || "";
    if (!src) return;
    const source = document.createElement("source");
    source.src = src;
    source.type = mediaMime(src, kind);
    el.appendChild(source);
  }

  function ensureMediaFallback(el, kind) {
    const href = directMediaUrl(el);
    if (!href) return null;
    const box = el.closest(".inline-media,.video-attachment,.audio-attachment,.audio-card") || el.parentElement;
    let fallback = box?.querySelector?.(":scope > .media-fallback:not(.format-warning)");
    if (!fallback && box) {
      const wrap = document.createElement("div");
      wrap.className = "media-fallback";
      wrap.innerHTML = `<span>${escapeHtml(mediaLabelFromUrl(href))}</span><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${kind === "audio" ? "Open audio" : "Open video"}</a>`;
      box.appendChild(wrap);
      fallback = wrap;
    }
    return fallback || null;
  }

  function wireNativeMediaFallbacks(root) {
    root.querySelectorAll("video,audio").forEach(el => {
      const kind = el.tagName.toLowerCase() === "audio" ? "audio" : "video";
      el.controls = true;
      if (kind === "video") el.setAttribute("playsinline", "");
      ensureSourceElement(el, kind);
      const fallback = ensureMediaFallback(el, kind);
      if (el.dataset.mediaFallbackWired) return;
      el.dataset.mediaFallbackWired = "1";
      const markProblem = () => {
        const box = el.closest(".inline-media,.video-attachment,.audio-attachment,.audio-card") || el.parentElement;
        box?.classList.add("media-error");
        if (fallback && !fallback.querySelector(".media-error-note")) {
          const note = document.createElement("em");
          note.className = "media-error-note";
          note.textContent = "Playback failed in the browser. Use Open media.";
          fallback.prepend(note);
        }
      };
      el.addEventListener("error", markProblem, true);
      el.querySelectorAll("source").forEach(source => source.addEventListener("error", markProblem, true));
    });
  }

  function replaceYouTubeElementWithFrame(el, embed, url) {
    if (!embed) return;
    const frame = document.createElement("iframe");
    frame.src = embed;
    frame.title = "YouTube video player";
    frame.loading = "lazy";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";

    const wrap = document.createElement("div");
    wrap.className = "video-frame active youtube-frame";
    wrap.appendChild(frame);

    const fallback = document.createElement("div");
    fallback.className = "media-fallback youtube-fallback";
    fallback.innerHTML = `<a href="${escapeHtml(url || embed)}" target="_blank" rel="noreferrer">Open on YouTube</a>`;

    const parent = el.parentElement;
    if (parent?.classList?.contains("youtube-discord-card") || parent?.classList?.contains("youtube-preview-card") || parent?.classList?.contains("embed-main")) {
      el.replaceWith(wrap);
      if (!parent.querySelector(".youtube-fallback")) parent.appendChild(fallback);
    } else {
      const box = document.createElement("div");
      box.className = "inline-media media-player youtube youtube-preview-card";
      box.appendChild(wrap);
      box.appendChild(fallback);
      el.replaceWith(box);
    }
  }

  function normalizeYouTubeFrameSrc(raw) {
    const id = getYouTubeId(raw);
    if (!id) return "";
    let start = 0;
    try {
      const u = new URL(String(raw || ""));
      start = parseYouTubeStart(u.searchParams.get("start") || u.searchParams.get("t") || "");
    } catch {}
    const params = new URLSearchParams({ rel: "0", playsinline: "1" });
    if (start > 0) params.set("start", String(start));
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }

  function normalizeYouTubeFrames(root) {
    root.querySelectorAll(".youtube-frame iframe, iframe[src*='youtube.com/embed/'], iframe[src*='youtube-nocookie.com/embed/']").forEach(frame => {
      const fixed = normalizeYouTubeFrameSrc(frame.getAttribute("src") || "");
      if (fixed && frame.getAttribute("src") !== fixed) frame.setAttribute("src", fixed);
      frame.setAttribute("title", frame.getAttribute("title") || "YouTube video player");
      frame.setAttribute("loading", "lazy");
      frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
      frame.setAttribute("allowfullscreen", "");
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    });
  }

  function pruneReplyReferenceMedia(root) {
    root.querySelectorAll(".reply-reference,.discord-reply-rich,.message-reference,.replied-message").forEach(ref => {
      ref.querySelectorAll(".inline-media,.youtube-preview-card,.youtube-discord-card,.video-frame,.media-fallback,.embed,.embeds,iframe,video,audio").forEach(el => el.remove());
      ref.querySelectorAll("img:not(.reply-avatar)").forEach(el => el.remove());
      ref.querySelectorAll("a[href]").forEach(a => {
        const span = document.createElement("span");
        span.className = "reply-preview-url";
        span.textContent = a.textContent || a.getAttribute("href") || "";
        a.replaceWith(span);
      });
    });
  }

  function wireLazyVideoPlayers(root) {
    root.querySelectorAll(".youtube-lite[data-embed]").forEach(btn => {
      const embed = btn.dataset.embed || "";
      const url = btn.dataset.url || embed;
      if (!embed) return;
      replaceYouTubeElementWithFrame(btn, embed, url);
    });

    root.querySelectorAll(".yt-thumb[data-embed], .yt-thumb[data-url]").forEach(thumb => {
      const url = thumb.dataset.url || thumb.getAttribute("href") || "";
      const embed = thumb.dataset.embed || getYouTubeEmbed(url);
      if (!embed) return;
      replaceYouTubeElementWithFrame(thumb, embed, url || embed);
    });

    root.querySelectorAll(".video-frame.youtube-frame").forEach(frame => {
      const iframe = frame.querySelector("iframe");
      if (!iframe) return;
      iframe.style.display = "block";
    });
  }


  function pruneDuplicateYouTubeCards(root) {
    root.querySelectorAll("article.message").forEach(message => {
      const youtubeEmbeds = message.querySelectorAll(".embed.youtube-embed,.youtube-embed");
      if (!youtubeEmbeds.length) return;

      // Keep the actual Discord embed, but do not also turn the raw message link into a second giant player.
      message.querySelectorAll(".content .inline-media.youtube,.content .youtube-preview-card").forEach(el => el.remove());

      youtubeEmbeds.forEach(embed => {
        // If a YouTube URL inside the title/description was auto-expanded, remove that nested card.
        embed.querySelectorAll(".embed-title .inline-media.youtube,.embed-title .youtube-preview-card,.embed-description .inline-media.youtube,.embed-description .youtube-preview-card,.embed-desc .inline-media.youtube,.embed-desc .youtube-preview-card").forEach(el => el.remove());
        embed.querySelectorAll(".embed-description .video-frame.youtube-frame,.embed-desc .video-frame.youtube-frame").forEach(el => el.remove());

        // Only one iframe belongs in a YouTube embed.
        const directFrames = Array.from(embed.querySelectorAll(":scope .embed-main > .video-frame.youtube-frame, :scope > .embed-main > .video-frame.youtube-frame"));
        directFrames.slice(1).forEach(el => el.remove());
      });
    });
  }

  function markReplySupport(root) {
    root.querySelectorAll(".reply-reference,.message-reference,.replied-message").forEach(el => el.classList.add("discord-reply-reference"));
    root.querySelectorAll('a[href*="discord.com/channels/"]').forEach(a => a.classList.add("discord-message-link"));
  }

  function collectLoadedUsers(root) {
    root.querySelectorAll("article.message").forEach(msg => {
      const id = msg.getAttribute("data-author-id");
      const author = msg.querySelector(".author");
      const avatar = msg.querySelector("img.avatar");
      if (!id || usersById.has(String(id))) return;
      usersById.set(String(id), getUser(id, author?.textContent?.trim(), avatar?.getAttribute("src")));
    });
  }

  function wireUserPopups(root) {
    root.querySelectorAll("article.message .author").forEach(author => {
      if (author.dataset.userPopup) return;
      author.dataset.userPopup = "1";
      author.tabIndex = 0;
      author.addEventListener("click", e => {
        const msg = author.closest("article.message");
        const avatar = msg?.querySelector("img.avatar")?.getAttribute("src");
        openUserPopup(getUser(msg?.getAttribute("data-author-id"), author.textContent.trim(), avatar));
      });
    });
    root.querySelectorAll(".user-mention").forEach(mention => {
      if (mention.dataset.userPopup) return;
      mention.dataset.userPopup = "1";
      mention.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        const raw = mention.textContent.replace(/^@/, "").trim();
        const numeric = /^\d{15,25}$/.test(raw) ? raw : null;
        const id = mention.dataset.userId || numeric || nameToId.get(raw.toLowerCase());
        openUserPopup(id ? getUser(id, raw) : { id:"Unknown", username:raw, displayName:raw, createdAt:null, firstMessageAt:null, lastMessageAt:null, messageCount:0 });
      });
    });
  }

  function wireInteractiveMedia(root) {
    root.querySelectorAll("img").forEach(img => {
      if (img.dataset.lightbox) return;
      if (img.classList.contains("emoji") || img.closest(".reaction")) return;
      img.dataset.lightbox = "1";
      img.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openImage(img.currentSrc || img.src, img.alt || "Image"); });
    });
  }
  function enhanceInactiveButtons(root) {
    root.querySelectorAll("article.message button, .embed button, .components button, .message-components button").forEach(btn => {
      if (btn.closest(".perm-icon")) return;
      btn.classList.add("discord-component-button");
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    });
    root.querySelectorAll(".components a, .message-components a, .embed .button, .component-button").forEach(el => {
      el.classList.add("discord-component-button", "disabled");
      el.setAttribute("aria-disabled", "true");
      el.removeAttribute("href");
    });
  }

  function postProcessMessages(root) {
    collectLoadedUsers(root);
    replaceCustomEmojiTextNodes(root);
    repairInlineCodeTokens(root);
    applyDiscordLineFormatting(root);
    pruneReplyReferenceMedia(root);
    enhanceMedia(root);
    enhanceBareMediaText(root);
    pruneReplyReferenceMedia(root);
    wireNativeMediaFallbacks(root);
    wireLazyVideoPlayers(root);
    normalizeYouTubeFrames(root);
    pruneDuplicateYouTubeCards(root);
    pruneReplyReferenceMedia(root);
    enhanceInactiveButtons(root);
    markReplySupport(root);
    wireUserPopups(root);
    wireInteractiveMedia(root);
  }

  async function activateChannel(id) {
    const ch = channelsById.get(String(id)); if (!ch) return;
    closeMobileSidebar();
    state.token++; const token = state.token; state.channelId = String(id); state.channel = ch; state.firstChunk = Math.max(0, (ch.chunkCount || 1) - 1); state.lastChunk = (ch.chunkCount || 0) - 1; state.loading = false;
    setChannelToolbar(true); setActiveButton(id); els.title.textContent = ch.name || id; els.messages.innerHTML = `<div class="loader">Loading latest messages...</div>`; els.scroller.scrollTop = 0; location.hash = id; updateMetaLine();
    if (!ch.chunkCount) { els.messages.innerHTML = `<div class="channel-intro">${meta.intros?.[id] || `<h3>${escapeHtml(ch.name || id)}</h3>`}</div><div class="notice">No messages were saved in this channel.</div>`; setStatus("0 messages"); return; }
    try {
      const html = await loadChunk(id, state.lastChunk); if (token !== state.token) return;
      const introHtml = state.firstChunk === 0 ? `<div class="channel-intro">${meta.intros?.[id] || ""}</div>` : "";
      els.messages.innerHTML = `${introHtml}<div class="load-row top"><button id="load-older-top">Load older messages</button><span>Showing newest chunk first</span></div><div class="chunk" data-chunk="${state.lastChunk}">${html}</div>`;
      document.getElementById("load-older-top")?.addEventListener("click", () => loadOlder());
      postProcessMessages(els.messages);
      els.scroller.scrollTop = els.scroller.scrollHeight; setStatus(`Loaded latest chunk for ${ch.name}`); updateMetaLine(); applySearch();
    } catch (err) { els.messages.innerHTML = `<div class="notice">Could not load channel data. ${escapeHtml(err.message)}</div>`; setStatus("Load failed"); }
  }

  async function loadOlder() {
    if (!state.channel || state.loading || state.firstChunk <= 0) return;
    state.loading = true; const token = state.token; const nextIdx = state.firstChunk - 1; const beforeHeight = els.scroller.scrollHeight; const beforeTop = els.scroller.scrollTop; setStatus(`Loading older chunk ${nextIdx + 1}/${state.channel.chunkCount}...`);
    try {
      const html = await loadChunk(state.channelId, nextIdx); if (token !== state.token) return; state.firstChunk = nextIdx;
      const chunk = document.createElement("div"); chunk.className = "chunk"; chunk.dataset.chunk = String(nextIdx); chunk.innerHTML = html;
      const firstChunkEl = els.messages.querySelector(".chunk"); if (firstChunkEl) els.messages.insertBefore(chunk, firstChunkEl); else els.messages.appendChild(chunk);
      if (state.firstChunk === 0 && !els.messages.querySelector(".channel-intro")) { const intro = document.createElement("div"); intro.className = "channel-intro"; intro.innerHTML = meta.intros?.[state.channelId] || ""; els.messages.insertBefore(intro, els.messages.firstChild); }
      postProcessMessages(chunk);
      const afterHeight = els.scroller.scrollHeight; els.scroller.scrollTop = beforeTop + (afterHeight - beforeHeight); setStatus(`Loaded older chunk ${nextIdx + 1}/${state.channel.chunkCount}`); updateMetaLine(); applySearch();
    } catch (err) { setStatus(`Load failed: ${err.message}`); } finally { state.loading = false; }
  }
  async function loadNewest() { if (state.channel) await activateChannel(state.channel.id); }
  function applySearch() { const q = (els.search.value || "").toLowerCase().trim(); const messages = els.messages.querySelectorAll(".message"); if (!q) { messages.forEach(m => m.classList.remove("hidden-by-search")); return; } messages.forEach(m => m.classList.toggle("hidden-by-search", !m.textContent.toLowerCase().includes(q))); if (state.channel) setStatus(`Searching loaded messages only. Loaded DOM messages: ${number(messages.length)}`); }
  let scrollTimer = null; function onScroll() { if (scrollTimer) return; scrollTimer = setTimeout(() => { scrollTimer = null; if (!state.channel || state.loading) return; if (els.scroller.scrollTop < 700) loadOlder(); }, 120); }

  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closeContextMenu(); } });
  buildSidebar(); els.search?.addEventListener("input", applySearch); els.scroller?.addEventListener("scroll", onScroll, { passive:true }); els.older?.addEventListener("click", loadOlder); els.newest?.addEventListener("click", loadNewest);
  const initial = (location.hash || "").slice(1); if (initial && initial !== "stats" && channelsById.has(initial)) activateChannel(initial); else showStats();
})();
