'use strict';

// For local dev without nginx, set globalThis.BACKEND_URL = 'http://localhost:8080'
const API_BASE = globalThis.BACKEND_URL || '/api';
const API      = API_BASE + '/transaction';

// ── DOM refs ────────────────────────────────────────────────────────────────
const form          = document.getElementById('addForm');
const formTitle     = document.getElementById('formTitle');
const amountInput   = document.getElementById('amount');
const categoryInput = document.getElementById('category');
const descInput     = document.getElementById('description');
const submitBtn     = document.getElementById('submitBtn');
const resetBtn      = document.getElementById('resetBtn');
const alertBox      = document.getElementById('alert');
const tbody         = document.getElementById('transactionBody');
const tableWrap     = document.getElementById('tableWrap');
const emptyState    = document.getElementById('emptyState');
const loadingEl     = document.getElementById('loading');
const deleteAllBtn  = document.getElementById('deleteAllBtn');
const refreshBtn    = document.getElementById('refreshBtn');
const statTotal     = document.getElementById('statTotal');
const statCount     = document.getElementById('statCount');
const statTopCat    = document.getElementById('statTopCat');
const demoGroups    = document.getElementById('demoGroups');
const demoHint      = document.getElementById('demoHint');
const logBody       = document.getElementById('logBody');
const logEmpty      = document.getElementById('logEmpty');
const clearLogBtn   = document.getElementById('clearLogBtn');

let editingId = null;   // null = adding, number = updating that expense

// ── HTTP status helpers ─────────────────────────────────────────────────────
const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  413: 'Content Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Content', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
};

function statusLabel(status) {
  return status + ' ' + (STATUS_TEXT[status] || '');
}

function statusClass(status) {
  if (!status) return 'sx';
  return 's' + String(status)[0];
}

// ── Activity log ────────────────────────────────────────────────────────────
const MAX_LOG = 30;

function logRequest(entry) {
  logEmpty.style.display = 'none';
  const tr = document.createElement('tr');
  const time = new Date().toLocaleTimeString();
  const statusHtml = entry.status
    ? '<span class="status-pill ' + statusClass(entry.status) + '">' + escHtml(statusLabel(entry.status)) + '</span>'
    : '<span class="status-pill sx">network error</span>';
  tr.innerHTML =
    '<td class="muted">' + escHtml(time) + '</td>' +
    '<td><span class="method">' + escHtml(entry.method) + '</span></td>' +
    '<td class="path">' + escHtml(entry.path) + '</td>' +
    '<td>' + statusHtml + '</td>' +
    '<td class="muted">' + entry.ms + ' ms</td>' +
    '<td class="note">' + escHtml(entry.note || '') + '</td>';
  logBody.insertBefore(tr, logBody.firstChild);
  while (logBody.children.length > MAX_LOG) logBody.removeChild(logBody.lastChild);
}

clearLogBtn.addEventListener('click', function() {
  logBody.innerHTML = '';
  logEmpty.style.display = 'block';
});

// ── API helper: every request goes through here and lands in the activity log ─
// opts: { json, body, headers, note, quiet }
async function api(method, url, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers);
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }

  const start = performance.now();
  let res;
  try {
    res = await fetch(url, { method: method, headers: headers, body: body, cache: 'no-store' });
  } catch (err) {
    logRequest({ method: method, path: url, status: 0, ms: Math.round(performance.now() - start), note: opts.note || err.message });
    throw err;
  }
  const ms = Math.round(performance.now() - start);

  let data = null;
  const type = res.headers.get('Content-Type') || '';
  if (res.status !== 204 && res.status !== 304) {
    data = type.includes('application/json') ? await res.json().catch(function() { return null; }) : await res.text();
  }

  let note = opts.note || '';
  if (res.redirected) {
    note = (note ? note + ' — ' : '') + 'browser followed redirect to ' + new URL(res.url).pathname;
  } else if (!note && data && typeof data === 'object' && data.message) {
    note = data.message;
  } else if (!note && typeof data === 'string' && data.includes('<title>')) {
    note = 'HTML error page from nginx';
  }
  if (!opts.quiet) logRequest({ method: method, path: url, status: res.status, ms: ms, note: note });

  return { res: res, status: res.status, data: data };
}

function errorText(r) {
  if (r.data && typeof r.data === 'object') {
    return r.data.errors ? r.data.errors.join(', ') : (r.data.message || '');
  }
  return '';
}

// ── Validation ───────────────────────────────────────────────────────────────
function clearErrors() {
  ['amount', 'category', 'description'].forEach(function(f) {
    document.getElementById(f).classList.remove('error');
    document.getElementById(f + 'Err').textContent = '';
  });
}

function setError(field, msg) {
  document.getElementById(field).classList.add('error');
  document.getElementById(field + 'Err').textContent = msg;
}

function validate() {
  clearErrors();
  let valid = true;

  const amount = Number(amountInput.value);
  if (amountInput.value.trim() === '') {
    setError('amount', 'Amount is required.');
    valid = false;
  } else if (!Number.isInteger(amount) || amount <= 0) {
    setError('amount', 'Amount must be a positive whole number.');
    valid = false;
  } else if (amount > 1000000) {
    setError('amount', 'Amount cannot exceed ₹10,00,000.');
    valid = false;
  }

  if (!categoryInput.value) {
    setError('category', 'Please select a category.');
    valid = false;
  }

  const desc = descInput.value.trim();
  if (!desc) {
    setError('description', 'Description is required.');
    valid = false;
  } else if (desc.length > 255) {
    setError('description', 'Description cannot exceed 255 characters.');
    valid = false;
  }

  return valid;
}

// Live clear errors on input
amountInput.addEventListener('input', function() {
  amountInput.classList.remove('error');
  document.getElementById('amountErr').textContent = '';
});
categoryInput.addEventListener('change', function() {
  categoryInput.classList.remove('error');
  document.getElementById('categoryErr').textContent = '';
});
descInput.addEventListener('input', function() {
  descInput.classList.remove('error');
  document.getElementById('descriptionErr').textContent = '';
});

// ── Alert banner ─────────────────────────────────────────────────────────────
let alertTimer;
function showAlert(msg, type) {
  clearTimeout(alertTimer);
  alertBox.textContent = msg;
  alertBox.className = type;
  alertBox.style.display = 'block';
  alertTimer = setTimeout(function() { alertBox.style.display = 'none'; }, 5000);
}

function showResult(r, successMsg) {
  if (r.res.ok) showAlert(statusLabel(r.status) + ' — ' + successMsg, 'success');
  else          showAlert(statusLabel(r.status) + ' — ' + (errorText(r) || 'request failed'), 'failure');
}

// ── Add / update mode ───────────────────────────────────────────────────────
function enterEditMode(row) {
  editingId = row.id;
  amountInput.value   = row.amount;
  categoryInput.value = row.category;
  descInput.value     = row.description;
  clearErrors();
  formTitle.textContent = 'Edit Expense #' + row.id;
  submitBtn.textContent = 'Update Expense';
  resetBtn.textContent  = 'Cancel';
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  amountInput.focus();
}

function exitEditMode() {
  editingId = null;
  form.reset();
  clearErrors();
  formTitle.textContent = 'Add Expense';
  submitBtn.textContent = 'Add Expense';
  resetBtn.textContent  = 'Reset';
}

form.addEventListener('submit', async function(e) {
  e.preventDefault();
  if (!validate()) return;

  const payload = {
    amount      : Number(amountInput.value),
    category    : categoryInput.value,
    description : descInput.value.trim()
  };
  const updating = editingId !== null;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    const r = updating
      ? await api('PUT', API + '/' + editingId, { json: payload })
      : await api('POST', API, { json: payload });
    showResult(r, updating ? 'Expense #' + editingId + ' updated.' : 'Expense added.');
    if (r.res.ok) {
      exitEditMode();
      fetchTransactions();
    }
  } catch {
    showAlert('Could not reach the backend. Is it running?', 'failure');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingId !== null ? 'Update Expense' : 'Add Expense';
  }
});

resetBtn.addEventListener('click', function() {
  exitEditMode();
  alertBox.style.display = 'none';
});

// ── Fetch & render ────────────────────────────────────────────────────────────
async function fetchTransactions() {
  loadingEl.innerHTML = '<div class="spinner"></div><p>Loading expenses&hellip;</p>';
  loadingEl.style.display = 'block';
  tableWrap.style.display = 'none';
  emptyState.style.display = 'none';

  try {
    const r = await api('GET', API);
    if (r.res.ok && r.data && r.data.result) {
      renderTable(r.data.result);
    } else {
      loadingEl.innerHTML = '<p>Failed to load expenses: <strong>' + escHtml(statusLabel(r.status)) + '</strong>' +
        (errorText(r) ? ' — ' + escHtml(errorText(r)) : '') + '</p>';
    }
  } catch {
    loadingEl.innerHTML = '<p>Failed to load expenses. Check backend connection.</p>';
  }
}

function renderTable(rows) {
  loadingEl.style.display = 'none';
  tbody.innerHTML = '';

  if (!rows.length) {
    emptyState.style.display = 'block';
    statTotal.textContent  = '₹0';
    statCount.textContent  = '0';
    statTopCat.textContent = '—';
    return;
  }

  const total = rows.reduce(function(sum, r) { return sum + (r.amount || 0); }, 0);
  statTotal.textContent = '₹' + total.toLocaleString('en-IN');
  statCount.textContent = rows.length;

  const catFreq = {};
  rows.forEach(function(r) { catFreq[r.category] = (catFreq[r.category] || 0) + 1; });
  const categories = Object.keys(catFreq);
  const topCat = categories.reduce(function(best, cat) {
    return catFreq[cat] > catFreq[best] ? cat : best;
  }, categories[0]);
  statTopCat.textContent = topCat;

  rows.forEach(function(row) {
    const tr = document.createElement('tr');
    const id = Number(row.id);
    tr.innerHTML =
      '<td>' + escHtml(String(row.id)) + '</td>' +
      '<td class="amount-cell">₹' + Number(row.amount).toLocaleString('en-IN') + '</td>' +
      '<td><span class="badge badge-' + escHtml(row.category) + '">' + escHtml(row.category) + '</span></td>' +
      '<td>' + escHtml(row.description) + '</td>' +
      '<td>' +
        '<button class="btn-icon edit" title="Edit" onclick="editOne(' + id + ')">✏️</button>' +
        '<button class="btn-icon" title="Delete" onclick="deleteOne(' + id + ')">🗑</button>' +
      '</td>';
    tbody.appendChild(tr);
  });

  tableWrap.style.display = 'block';
}

// ── Edit ──────────────────────────────────────────────────────────────────────
// Loads the latest copy from the server (GET /transaction/:id) before editing
async function editOne(id) {
  try {
    const r = await api('GET', API + '/' + id);
    if (r.res.ok) enterEditMode(r.data);
    else          showResult(r, '');
  } catch {
    showAlert('Network error while loading expense.', 'failure');
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteOne(id) {
  if (!confirm('Delete expense #' + id + '?')) return;
  try {
    const r = await api('DELETE', API + '/' + id);
    showResult(r, 'Expense #' + id + ' deleted.');
    if (editingId === id) exitEditMode();
    fetchTransactions();
  } catch {
    showAlert('Network error while deleting.', 'failure');
  }
}

deleteAllBtn.addEventListener('click', async function() {
  const token = prompt('Delete ALL expenses?\n\nEnter the admin token (leave blank to see 401, type a wrong one to see 403):');
  if (token === null) return;   // cancelled
  const headers = token.trim() ? { Authorization: 'Bearer ' + token.trim() } : {};
  try {
    const r = await api('DELETE', API, { headers: headers });
    showResult(r, 'All expenses deleted.');
    if (r.res.ok) { exitEditMode(); fetchTransactions(); }
  } catch {
    showAlert('Network error.', 'failure');
  }
});

refreshBtn.addEventListener('click', fetchTransactions);

// ── Status code playground ────────────────────────────────────────────────────
const SAMPLE = { amount: 99, category: 'Other', description: 'Status code demo' };

const DEMOS = [
  { code: 200, hint: 'GET /api/transaction: lists all expenses.',
    run: function() { return api('GET', API); } },
  { code: 201, hint: 'POST a sample expense. The response has a Location header pointing at the new row.',
    run: async function() { await api('POST', API, { json: SAMPLE }); fetchTransactions(); } },
  { code: 204, hint: 'Creates a temporary expense, then DELETEs it. Success with no response body.',
    run: async function() {
      const r = await api('POST', API, { json: SAMPLE, note: 'step 1: create temp expense' });
      if (r.status === 201) await api('DELETE', API + '/' + r.data.id, { note: 'step 2: delete it' });
    } },

  { code: 301, hint: 'GET /api/transactions (old URL). The server replies 301 and the browser follows it. See the 301 in DevTools → Network.',
    run: function() { return api('GET', API_BASE + '/transactions', { note: 'server sent 301' }); } },
  { code: 302, hint: 'GET /api/latest. Temporary redirect to whichever expense is newest right now.',
    run: function() { return api('GET', API_BASE + '/latest', { note: 'server sent 302' }); } },
  { code: 304, hint: 'GET the list, then GET again with If-None-Match: <ETag>. Nothing changed, so there is no body.',
    run: async function() {
      const first = await api('GET', API, { note: 'step 1: get ETag' });
      const etag = first.res.headers.get('ETag');
      if (!etag) { showAlert('No ETag header in the response, so 304 cannot be shown.', 'failure'); return; }
      // Cache-Control stops fetch from adding "no-cache", which would make Express always answer 200
      await api('GET', API, { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' }, note: 'step 2: If-None-Match ' + etag });
    } },
  { code: 308, hint: 'POST /api/transactions. 308 keeps the method and body, so it is re-sent as POST /api/transaction.',
    run: async function() { await api('POST', API_BASE + '/transactions', { json: SAMPLE, note: 'server sent 308' }); fetchTransactions(); } },

  { code: 400, hint: 'POST a broken JSON body. The server cannot even parse it.',
    run: function() { return api('POST', API, { body: '{"amount": 100,', headers: { 'Content-Type': 'application/json' } }); } },
  { code: 401, hint: 'DELETE all with no Authorization header. Who are you?',
    run: function() { return api('DELETE', API); } },
  { code: 403, hint: 'DELETE all with a wrong admin token. We know who you are, but you are not allowed.',
    run: function() { return api('DELETE', API, { headers: { Authorization: 'Bearer wrong-token' } }); } },
  { code: 404, hint: 'GET /api/transaction/999999. That expense does not exist.',
    run: function() { return api('GET', API + '/999999'); } },
  { code: 405, hint: 'PATCH /api/transaction. The route exists but does not support PATCH (see the Allow header).',
    run: function() { return api('PATCH', API, { json: SAMPLE }); } },
  { code: 413, hint: 'POST a 20 KB body. The backend accepts at most 10 KB.',
    run: function() { return api('POST', API, { json: { amount: 1, category: 'Other', description: 'x'.repeat(20000) } }); } },
  { code: 415, hint: 'POST as text/plain instead of application/json.',
    run: function() { return api('POST', API, { body: 'amount=100', headers: { 'Content-Type': 'text/plain' } }); } },
  { code: 422, hint: 'POST valid JSON that fails the validation rules (negative amount, unknown category).',
    run: function() { return api('POST', API, { json: { amount: -5, category: 'Crypto', description: '' } }); } },
  { code: 429, hint: 'Sends write requests until the rate limit trips. After this, writes are blocked for about a minute.',
    run: async function() {
      const counts = {};
      for (let i = 0; i < 50; i++) {
        const r = await api('PUT', API + '/999999', { json: {}, quiet: true });
        counts[r.status] = (counts[r.status] || 0) + 1;
        if (r.status === 429) {
          const summary = Object.keys(counts).map(function(s) { return counts[s] + '× ' + s; }).join(', ');
          logRequest({ method: 'PUT', path: API + '/999999', status: 429, ms: 0,
            note: 'after ' + (i + 1) + ' requests (' + summary + '), Retry-After: ' + r.res.headers.get('Retry-After') + 's' });
          return;
        }
      }
    } },

  { code: 500, hint: 'GET /api/error. The backend code throws an unhandled exception.',
    run: function() { return api('GET', API_BASE + '/error'); } },
  { code: 503, hint: 'GET /api/maintenance. The backend says it is temporarily unavailable (Retry-After header).',
    run: function() { return api('GET', API_BASE + '/maintenance'); } },
  { code: 504, hint: 'GET /api/slow. The backend takes 40s, so nginx gives up first (frontend 30s, LB 10s). Wait for it…',
    run: function() { return api('GET', API_BASE + '/slow'); } }
];

const GROUPS = [
  { cls: 's2', title: '2XX Success' },
  { cls: 's3', title: '3XX Redirection' },
  { cls: 's4', title: '4XX Client Error' },
  { cls: 's5', title: '5XX Server Error' }
];

function buildPlayground() {
  GROUPS.forEach(function(g) {
    const wrap = document.createElement('div');
    wrap.className = 'demo-group';
    const title = document.createElement('div');
    title.className = 'demo-title ' + g.cls;
    title.textContent = g.title;
    wrap.appendChild(title);

    const btns = document.createElement('div');
    btns.className = 'demo-btns';
    DEMOS.filter(function(d) { return 's' + String(d.code)[0] === g.cls; }).forEach(function(d) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'code-btn ' + g.cls;
      b.textContent = statusLabel(d.code);
      b.title = d.hint;
      b.addEventListener('mouseenter', function() { demoHint.textContent = d.hint; });
      b.addEventListener('click', async function() {
        demoHint.textContent = d.hint;
        b.disabled = true;
        try { await d.run(); } catch { /* already in the log */ }
        b.disabled = false;
      });
      btns.appendChild(b);
    });
    wrap.appendChild(btns);
    demoGroups.appendChild(wrap);
  });
}

// ── XSS guard ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replaceAll('&',  '&amp;')
    .replaceAll('<',  '&lt;')
    .replaceAll('>',  '&gt;')
    .replaceAll('"',  '&quot;')
    .replaceAll("'",  '&#039;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
buildPlayground();
fetchTransactions();
