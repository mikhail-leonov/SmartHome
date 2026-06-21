/* ───────────────────────────────────────────────────────────────
   SmartHome dashboard client.
   Connects to /ws, applies the initial snapshot, then patches values in
   place as state/activity/status messages arrive. No page refresh.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var STALE_MS = 15 * 60 * 1000; // flag variables not seen in 15 min
  var activityEl = document.getElementById('activity');
  var staleTimer;

  // ── Helpers ───────────────────────────────────────────────
  function fmtRelative(ts) {
    if (!ts) return 'no data';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  }

  function rowFor(topic) {
    return document.querySelector('.var-row[data-topic="' + cssEscape(topic) + '"]');
  }

  function cssEscape(s) {
    return s.replace(/"/g, '\\"');
  }

  // ── Apply a single state value to its row ─────────────────
  function applyValue(rec) {
    var row = rowFor(rec.topic);
    if (!row) return; // variable not present on a room card (e.g. system topic)

    var valEl = row.querySelector('.var-value');
    var timeEl = row.querySelector('.var-time');
    var display = typeof rec.value === 'object' ? JSON.stringify(rec.value) : String(rec.value);
    valEl.textContent = display;
    valEl.dataset.updated = rec.updatedAt;
    timeEl.textContent = fmtRelative(rec.updatedAt);
    row.dataset.updatedAt = rec.updatedAt;
    row.classList.remove('stale');

    // amber-highlight commanded/active-ish values
    valEl.classList.toggle('active', display === 'open' || display === 'cleaning' || display === 'on');
    valEl.classList.toggle('alert', display === 'closed' && false); // reserved

    // heartbeat
    row.classList.remove('fresh');
    void row.offsetWidth; // restart animation
    row.classList.add('fresh');

    // also reflect into system tiles if present
    applySystemTile(rec.topic, display);
  }

  function applySystemTile(topic, display) {
    var tile = document.querySelector('.sys-tile[data-topic="' + cssEscape(topic) + '"] .v');
    if (tile) tile.textContent = display;
  }

  // ── Status pills ──────────────────────────────────────────
  function applyStatus(status) {
    setPill('pill-mqtt', status.mqtt);
    setPill('pill-db', status.db);
    var seasonEl = document.getElementById('pill-season');
    if (seasonEl && status.season) {
      seasonEl.querySelector('.txt').textContent = status.season;
    }
    var sTile = document.querySelector('.sys-tile[data-key="season"] .v');
    if (sTile && status.season) {
      sTile.textContent = status.season;
      sTile.className = 'v season-' + status.season;
    }
  }

  function setPill(id, on) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('on', !!on);
    el.classList.toggle('off', !on);
    var txt = el.querySelector('.txt');
    if (txt) txt.textContent = txt.dataset.label + ' ' + (on ? 'online' : 'offline');
  }

  // ── Activity log ──────────────────────────────────────────
  function addActivity(item, prepend) {
    if (!activityEl) return;
    var node = document.createElement('div');
    node.className = 'log-item';
    var detail = item.detail ? '<span class="detail"> · ' + escapeHtml(item.detail) + '</span>' : '';
    node.innerHTML =
      '<span class="when">' + fmtTime(item.at) + '</span>' +
      '<span class="badge-kind k-' + item.kind + '">' + item.kind + '</span>' +
      '<span class="msg">' + escapeHtml(item.message) + detail + '</span>';
    if (prepend && activityEl.firstChild) {
      activityEl.insertBefore(node, activityEl.firstChild);
    } else {
      activityEl.appendChild(node);
    }
    while (activityEl.children.length > 80) {
      activityEl.removeChild(activityEl.lastChild);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── Staleness sweep ───────────────────────────────────────
  function sweepStale() {
    document.querySelectorAll('.var-row').forEach(function (row) {
      var ts = Number(row.dataset.updatedAt || 0);
      var timeEl = row.querySelector('.var-time');
      if (ts) {
        timeEl.textContent = fmtRelative(ts);
        row.classList.toggle('stale', Date.now() - ts > STALE_MS);
      }
    });
  }

  // ── WebSocket wiring ──────────────────────────────────────
  function connect() {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var ws = new WebSocket(proto + '://' + location.host + '/ws');

    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'snapshot':
          Object.values(msg.state).forEach(function (rec) {
            applyValue(rec);
            row_unfresh(rec.topic);
          });
          (msg.activity || []).slice().reverse().forEach(function (i) { addActivity(i, false); });
          // snapshot activity is newest-first in buffer; we reversed to append oldest first
          applyStatus(msg.status);
          sweepStale();
          break;
        case 'state':
          applyValue(msg.value);
          break;
        case 'activity':
          addActivity(msg.item, true);
          if (msg.status) applyStatus(msg.status);
          break;
        case 'status':
          applyStatus(msg.status);
          break;
      }
    };

    ws.onclose = function () {
      setPill('pill-mqtt', false);
      setTimeout(connect, 2500); // auto-reconnect
    };
    ws.onerror = function () { ws.close(); };
  }

  // remove the fresh animation class applied during snapshot replay
  function row_unfresh(topic) {
    var row = rowFor(topic);
    if (row) row.classList.remove('fresh');
  }

  // ── Simulate controls ─────────────────────────────────────
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sim]');
    if (!t) return;
    var kind = t.dataset.sim;
    if (kind === 'garage-open') post('/api/simulate/garage-open');
    else if (kind === 'season') post('/api/simulate/season', { season: t.dataset.season });
    else if (kind === 'hot') {
      post('/api/publish', { topic: t.dataset.topic, value: Number(t.dataset.value) });
    }
  });

  connect();
  staleTimer = setInterval(sweepStale, 10000);
})();
