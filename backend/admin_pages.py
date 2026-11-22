"""Pages web d'administration servies par le backend.

HTML et JavaScript autonomes : chaque page s'authentifie elle-même puis
appelle les routes `/api/admin/*`. Contenu statique, sans dépendance :
`server.py` ne fait que les servir.
"""


ADMIN_RECIPES_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeepEat — Import recettes</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#1a1a1a;min-height:100vh}
  .header{background:#16a34a;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;font-weight:700}
  .header span{font-size:22px}
  .container{max-width:860px;margin:32px auto;padding:0 16px}
  .card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:24px;margin-bottom:20px}
  .card h2{font-size:15px;font-weight:700;color:#166534;margin-bottom:16px}
  label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
  input[type=email],input[type=password],input[type=text]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none}
  input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer}
  button:hover{background:#15803d}
  button.secondary{background:#fff;color:#16a34a;border:1px solid #16a34a}
  button.secondary:hover{background:#f0fdf4}
  button:disabled{opacity:.5;cursor:not-allowed}
  textarea{width:100%;height:320px;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-family:monospace;font-size:12px;resize:vertical;outline:none}
  textarea:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .drop-zone{border:2px dashed #86efac;border-radius:10px;padding:28px;text-align:center;color:#166534;cursor:pointer;transition:.2s;background:#f0fdf4;margin-bottom:12px}
  .drop-zone:hover,.drop-zone.drag-over{border-color:#16a34a;background:#dcfce7}
  .drop-zone p{font-size:14px;font-weight:600;margin-bottom:4px}
  .drop-zone small{font-size:12px;color:#4ade80}
  .or{text-align:center;font-size:12px;color:#9ca3af;margin:12px 0;position:relative}
  .or::before,.or::after{content:"";position:absolute;top:50%;width:44%;height:1px;background:#e5e7eb}
  .or::before{left:0}.or::after{right:0}
  .result{border-radius:8px;padding:14px;font-size:13px;line-height:1.6;margin-top:16px}
  .result.success{background:#f0fdf4;border:1px solid #86efac;color:#166534}
  .result.error{background:#fef2f2;border:1px solid #fca5a5;color:#dc2626}
  .result.info{background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8}
  .detail-row{display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.06)}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
  .badge.added{background:#dcfce7;color:#166534}
  .badge.skipped{background:#fef9c3;color:#854d0e}
  .badge.error{background:#fee2e2;color:#991b1b}
  #login-section{display:block}
  #import-section{display:none}
  .logged-as{font-size:12px;color:#6b7280;margin-left:auto}
  a.logout{font-size:12px;color:#dc2626;cursor:pointer;margin-left:12px;text-decoration:underline}
  .hint{font-size:12px;color:#6b7280;margin-top:6px}
</style>
</head>
<body>
<div class="header">
  <span>🥗</span>
  <h1>KeepEat — Import de recettes</h1>
  <nav style="display:flex;gap:8px;margin-left:auto;align-items:center">
    <a href="/admin/dashboard" style="color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)">Dashboard</a>
    <a href="/admin/tickets" style="color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)">Tickets</a>
  </nav>
  <span id="logged-info" class="logged-as" style="display:none"></span>
  <a id="btn-logout" class="logout" style="display:none" onclick="logout()">Deconnexion</a>
</div>
<div class="container">

  <!-- LOGIN -->
  <div class="card" id="login-section">
    <h2>Connexion admin</h2>
    <div class="row" style="margin-bottom:12px">
      <div><label>Email</label><input id="email" type="email" placeholder="admin@example.com" autocomplete="username"></div>
      <div><label>Mot de passe</label><input id="password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    </div>
    <button onclick="login()">Se connecter</button>
    <div id="login-result"></div>
  </div>

  <!-- IMPORT -->
  <div class="card" id="import-section">
    <h2>Importer des recettes</h2>
    <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
      <p>Glisser-deposer un fichier JSON ici</p>
      <small>ou cliquer pour choisir un fichier</small>
    </div>
    <input id="file-input" type="file" accept=".json,application/json" style="display:none" onchange="loadFile(this)">
    <div class="or">ou coller le JSON directement</div>
    <label>Contenu JSON <span style="font-weight:400;color:#9ca3af">(tableau de recettes ou objet avec clé "recipes")</span></label>
    <textarea id="json-input" placeholder='[&#10;  {&#10;    "title": "Ma recette",&#10;    "summary": "Description...",&#10;    "ingredients_required": ["ingredient1"],&#10;    "ingredients_optional": [],&#10;    "steps": ["Etape 1.", "Etape 2."],&#10;    "prep_time_min": 10,&#10;    "cook_time_min": 15,&#10;    "difficulty": "easy",&#10;    "tags": [],&#10;    "meal_type": ["dinner"],&#10;    "servings": 2&#10;  }&#10;]'></textarea>
    <p class="hint">Champs obligatoires : title, summary, ingredients_required, steps, prep_time_min</p>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button onclick="importRecipes()" id="btn-import">Importer</button>
      <button class="secondary" onclick="document.getElementById('json-input').value=''">Effacer</button>
    </div>
    <div id="import-result"></div>
  </div>

</div>
<script>
let token = localStorage.getItem('keepeat_admin_token');
let userEmail = localStorage.getItem('keepeat_admin_email');
if (token) showImportSection();

function showImportSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('import-section').style.display = 'block';
  const info = document.getElementById('logged-info');
  info.textContent = userEmail || 'admin';
  info.style.display = 'inline';
  document.getElementById('btn-logout').style.display = 'inline';
}

async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const res = document.getElementById('login-result');
  if (!email || !password) { res.innerHTML = '<div class="result error">Email et mot de passe requis.</div>'; return; }
  try {
    const r = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data = await r.json();
    if (!r.ok) { res.innerHTML = '<div class="result error">' + (data.detail || 'Identifiants incorrects.') + '</div>'; return; }
    token = data.access_token;
    localStorage.setItem('keepeat_admin_token', token);
    localStorage.setItem('keepeat_admin_email', email);
    userEmail = email;
    showImportSection();
  } catch(e) { res.innerHTML = '<div class="result error">Erreur reseau : ' + e.message + '</div>'; }
}

function logout() {
  localStorage.removeItem('keepeat_admin_token');
  localStorage.removeItem('keepeat_admin_email');
  token = null;
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('import-section').style.display = 'none';
  document.getElementById('logged-info').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
}

function loadFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { document.getElementById('json-input').value = e.target.result; };
  reader.readAsText(file);
}

const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) { const r = new FileReader(); r.onload = ev => { document.getElementById('json-input').value = ev.target.result; }; r.readAsText(file); }
});

async function importRecipes() {
  const raw = document.getElementById('json-input').value.trim();
  const res = document.getElementById('import-result');
  const btn = document.getElementById('btn-import');
  if (!raw) { res.innerHTML = '<div class="result error">Collez ou chargez un fichier JSON d abord.</div>'; return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e) { res.innerHTML = '<div class="result error">JSON invalide : ' + e.message + '</div>'; return; }
  const recipes = Array.isArray(parsed) ? parsed : (parsed.recipes || null);
  if (!recipes) { res.innerHTML = '<div class="result error">Format attendu : tableau JSON ou objet avec cle "recipes".</div>'; return; }
  btn.disabled = true; btn.textContent = 'Import en cours...';
  try {
    const r = await fetch('/api/admin/recipes/import', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({recipes})
    });
    const data = await r.json();
    if (r.status === 401) { logout(); res.innerHTML = '<div class="result error">Session expiree. Reconnectez-vous.</div>'; return; }
    if (!r.ok) { res.innerHTML = '<div class="result error">' + JSON.stringify(data.detail || data) + '</div>'; return; }
    let html = '<div class="result success"><strong>Resultat : ' + data.added + ' ajoutee(s), ' + data.skipped + ' ignoree(s), ' + data.errors + ' erreur(s).</strong><br><br>';
    for (const d of data.details) {
      const badge = '<span class="badge ' + d.status + '">' + d.status + '</span>';
      html += '<div class="detail-row">' + badge + ' ' + d.title + (d.reason ? ' <em style=\\"color:#9ca3af\\">(' + d.reason + ')</em>' : '') + '</div>';
    }
    html += '</div>';
    res.innerHTML = html;
  } catch(e) { res.innerHTML = '<div class="result error">Erreur reseau : ' + e.message + '</div>'; }
  finally { btn.disabled = false; btn.textContent = 'Importer'; }
}

document.getElementById('password').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
</script>
</body>
</html>"""


ADMIN_TICKETS_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeepEat — Tickets de caisse</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#1a1a1a;min-height:100vh}
  .header{background:#16a34a;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;font-weight:700}
  .header nav{display:flex;gap:8px;margin-left:auto;align-items:center}
  .header nav a{color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)}
  .header nav a:hover{opacity:1;background:rgba(255,255,255,.15)}
  .logged-as{font-size:12px;color:rgba(255,255,255,.75);margin-right:4px}
  a.logout{font-size:12px;color:#fca5a5;cursor:pointer;text-decoration:underline}
  .container{max-width:1100px;margin:28px auto;padding:0 16px;display:flex;flex-direction:column;gap:16px}
  .card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:24px}
  .card h2{font-size:15px;font-weight:700;color:#166534;margin-bottom:16px}
  label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
  input[type=email],input[type=password],input[type=text]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none}
  input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;transition:.15s}
  button:hover{background:#15803d}
  button.secondary{background:#fff;color:#374151;border:1px solid #d1d5db}
  button.secondary:hover{background:#f9fafb}
  button.danger{background:#ef4444}
  button.danger:hover{background:#dc2626}
  button:disabled{opacity:.5;cursor:not-allowed}
  .result{border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.6;margin-top:12px}
  .result.success{background:#f0fdf4;border:1px solid #86efac;color:#166534}
  .result.error{background:#fef2f2;border:1px solid #fca5a5;color:#dc2626}
  .result.info{background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8}
  /* Filters */
  .filter-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .filter-btn{padding:6px 14px;border-radius:999px;border:1.5px solid #d1d5db;background:#fff;font-size:13px;font-weight:700;color:#6b7280;cursor:pointer;transition:.15s}
  .filter-btn:hover{border-color:#16a34a;color:#166534}
  .filter-btn.active{border-color:#16a34a;background:#f0fdf4;color:#166534}
  .filter-count{font-size:12px;color:#9ca3af;margin-left:auto}
  /* Tickets list */
  .tickets-grid{display:flex;flex-direction:column;gap:10px}
  .ticket-card{background:#fff;border-radius:10px;border:1.5px solid #e5e7eb;padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:.15s}
  .ticket-card:hover{border-color:#86efac;box-shadow:0 2px 8px rgba(0,0,0,.07)}
  .ticket-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
  .ticket-info{flex:1;min-width:0}
  .ticket-email{font-size:14px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ticket-meta{font-size:12px;color:#6b7280;margin-top:2px}
  .ticket-badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;flex-shrink:0}
  /* Modal */
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;z-index:100;overflow-y:auto}
  .modal{background:#fff;border-radius:16px;width:100%;max-width:780px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18)}
  .modal-header{background:#f0fdf4;padding:16px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #d1fae5}
  .modal-header h3{font-size:16px;font-weight:800;color:#111827;flex:1}
  .modal-close{background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;padding:0 4px;line-height:1}
  .modal-close:hover{color:#374151}
  .modal-body{padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
  @media(max-width:640px){.modal-body{grid-template-columns:1fr}}
  .receipt-img{width:100%;border-radius:10px;border:1px solid #e5e7eb;max-height:420px;object-fit:contain;background:#f9fafb}
  .receipt-placeholder{width:100%;height:200px;border-radius:10px;border:1.5px dashed #d1d5db;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:14px}
  .form-section{display:flex;flex-direction:column;gap:12px}
  .items-list{display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto}
  .item-row{background:#f9fafb;border-radius:8px;padding:10px;border:1px solid #e5e7eb;display:flex;flex-direction:column;gap:8px}
  .item-row-top{display:flex;gap:8px}
  .item-row-top input{flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
  .remove-btn{background:#fee2e2;color:#ef4444;border:none;border-radius:6px;padding:0 10px;font-weight:700;cursor:pointer;font-size:16px}
  .remove-btn:hover{background:#fecaca}
  .cats{display:flex;gap:5px;flex-wrap:wrap}
  .cat-btn{padding:3px 9px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;font-size:11px;font-weight:600;color:#6b7280;cursor:pointer}
  .cat-btn:hover{border-color:#16a34a;color:#166534}
  .cat-btn.active{border-color:#16a34a;background:#dcfce7;color:#166534}
  .expiry-input{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;color:#374151}
  .add-item-btn{border:1.5px dashed #86efac;background:#f0fdf4;color:#166534;font-size:13px;font-weight:700;border-radius:8px;padding:10px;cursor:pointer;width:100%;text-align:center}
  .add-item-btn:hover{background:#dcfce7}
  .note-input{width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;resize:vertical;min-height:60px;outline:none}
  .note-input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .action-row{display:flex;gap:10px;margin-top:4px}
  .action-row button{flex:1}
  /* Status colors */
  .dot-pending{background:#f59e0b}
  .dot-processed{background:#16a34a}
  .dot-dismissed{background:#9ca3af}
  .badge-pending{background:#fef3c7;color:#92400e}
  .badge-processed{background:#dcfce7;color:#166534}
  .badge-dismissed{background:#f3f4f6;color:#6b7280}
  /* Processed info */
  .processed-banner{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;font-size:13px;color:#166534}
  .items-added-list{margin-top:8px;font-size:12px;color:#374151;list-style:disc;padding-left:18px}
  /* Loader */
  .spinner{display:inline-block;width:18px;height:18px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle}
  @keyframes spin{to{transform:rotate(360deg)}}
  #login-section{display:block}
  #tickets-section{display:none}
</style>
</head>
<body>
<div class="header">
  <span>🧾</span>
  <h1>KeepEat — Tickets de caisse</h1>
  <nav>
    <a href="/admin/dashboard">Dashboard</a>
    <a href="/admin/recipes">Recettes</a>
    <span id="logged-info" class="logged-as" style="display:none"></span>
    <a id="btn-logout" class="logout" style="display:none" onclick="logout()">Déconnexion</a>
  </nav>
</div>
<div class="container">

  <!-- LOGIN -->
  <div class="card" id="login-section">
    <h2>Connexion admin</h2>
    <div class="row" style="margin-bottom:12px">
      <div><label>Email</label><input id="email" type="email" placeholder="admin@example.com" autocomplete="username"></div>
      <div><label>Mot de passe</label><input id="password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    </div>
    <button onclick="doLogin()">Se connecter</button>
    <div id="login-result"></div>
  </div>

  <!-- TICKETS -->
  <div id="tickets-section">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0">Tickets de caisse</h2>
        <button class="secondary" onclick="loadTickets()" style="padding:7px 14px;font-size:13px">Actualiser</button>
      </div>
      <div class="filter-bar" style="margin-bottom:14px">
        <button class="filter-btn active" data-status="pending"   onclick="setFilter('pending')">En attente</button>
        <button class="filter-btn"        data-status="processed" onclick="setFilter('processed')">Traités</button>
        <button class="filter-btn"        data-status="dismissed" onclick="setFilter('dismissed')">Ignorés</button>
        <button class="filter-btn"        data-status="all"       onclick="setFilter('all')">Tous</button>
        <span class="filter-count" id="filter-count"></span>
      </div>
      <div class="tickets-grid" id="tickets-list">
        <div class="result info">Chargement des tickets...</div>
      </div>
      <div id="list-result"></div>
    </div>
  </div>

</div>

<!-- MODAL -->
<div class="modal-overlay" id="modal-overlay" style="display:none" onclick="closeModal(event)">
  <div class="modal" id="modal-box">
    <div class="modal-header">
      <h3 id="modal-title">Ticket</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" id="modal-body">
      <div class="result info">Chargement...</div>
    </div>
  </div>
</div>

<script>
const CATS = ['frais','proteines','legumes','feculents','desserts','boissons','epicerie','autres'];
let token = localStorage.getItem('keepeat_admin_token');
let userEmail = localStorage.getItem('keepeat_admin_email');
let currentFilter = 'pending';
let currentTicketId = null;

if (token) showTicketsSection();

function showTicketsSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('tickets-section').style.display = 'block';
  const info = document.getElementById('logged-info');
  info.textContent = userEmail || 'admin';
  info.style.display = 'inline';
  document.getElementById('btn-logout').style.display = 'inline';
  loadTickets();
}

async function doLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const res = document.getElementById('login-result');
  if (!email || !password) { res.innerHTML = '<div class="result error">Email et mot de passe requis.</div>'; return; }
  try {
    const r = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data = await r.json();
    if (!r.ok) { res.innerHTML = '<div class="result error">' + (data.detail || 'Identifiants incorrects.') + '</div>'; return; }
    token = data.access_token;
    localStorage.setItem('keepeat_admin_token', token);
    localStorage.setItem('keepeat_admin_email', email);
    userEmail = email;
    showTicketsSection();
  } catch(e) { res.innerHTML = '<div class="result error">Erreur réseau : ' + e.message + '</div>'; }
}

function logout() {
  localStorage.removeItem('keepeat_admin_token');
  localStorage.removeItem('keepeat_admin_email');
  token = null;
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('tickets-section').style.display = 'none';
  document.getElementById('logged-info').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
}

function setFilter(status) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.status === status);
  });
  loadTickets();
}

async function loadTickets() {
  const list = document.getElementById('tickets-list');
  list.innerHTML = '<div class="result info">Chargement...</div>';
  document.getElementById('list-result').innerHTML = '';
  try {
    const r = await fetch('/api/admin/receipt-tickets?status=' + currentFilter + '&limit=50&skip=0', {
      headers: {'Authorization':'Bearer '+token}
    });
    if (r.status === 401) { logout(); return; }
    const data = await r.json();
    document.getElementById('filter-count').textContent = data.total + ' ticket' + (data.total > 1 ? 's' : '');
    if (data.tickets.length === 0) {
      list.innerHTML = '<div class="result info">Aucun ticket dans cette catégorie.</div>';
      return;
    }
    list.innerHTML = data.tickets.map(t => {
      const dotClass = 'dot-' + t.status;
      const badgeClass = 'badge-' + t.status;
      const labels = {pending:'En attente', processed:'Traité', dismissed:'Ignoré'};
      const date = new Date(t.created_at).toLocaleString('fr-FR');
      const itemsInfo = t.status === 'processed' && t.items_added && t.items_added.length > 0
        ? '<span style="font-size:11px;color:#16a34a;margin-left:8px">✓ ' + t.items_added.length + ' produit(s) ajouté(s)</span>'
        : '';
      return '<div class="ticket-card" onclick="openTicket(\'' + t.id + '\')">'
        + '<div class="ticket-dot ' + dotClass + '"></div>'
        + '<div class="ticket-info">'
        + '<div class="ticket-email">' + escHtml(t.user_email || t.user_id) + '</div>'
        + '<div class="ticket-meta">' + date + itemsInfo + '</div>'
        + '</div>'
        + '<span class="ticket-badge ' + badgeClass + '">' + (labels[t.status] || t.status) + '</span>'
        + '</div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<div class="result error">Erreur : ' + e.message + '</div>';
  }
}

async function openTicket(ticketId) {
  currentTicketId = ticketId;
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');
  title.textContent = 'Chargement…';
  body.innerHTML = '<div style="padding:20px"><div class="result info">Chargement du ticket...</div></div>';
  overlay.style.display = 'flex';

  try {
    const r = await fetch('/api/admin/receipt-tickets/' + ticketId, {
      headers: {'Authorization':'Bearer '+token}
    });
    if (r.status === 401) { logout(); closeModal(); return; }
    const ticket = await r.json();
    title.textContent = 'Ticket — ' + (ticket.user_email || ticket.user_id);
    renderModal(ticket);
  } catch(e) {
    body.innerHTML = '<div style="padding:20px"><div class="result error">Erreur : ' + e.message + '</div></div>';
  }
}

function renderModal(ticket) {
  const body = document.getElementById('modal-body');
  const date = new Date(ticket.created_at).toLocaleString('fr-FR');
  const imgHtml = ticket.image_b64
    ? '<img class="receipt-img" src="data:image/jpeg;base64,' + ticket.image_b64 + '" alt="Ticket de caisse">'
    : '<div class="receipt-placeholder">Pas d\'image disponible</div>';

  let rightPanel = '';
  if (ticket.status !== 'pending') {
    // Read-only view for processed/dismissed
    const labels = {processed:'Traité ✓', dismissed:'Ignoré'};
    let itemsList = '';
    if (ticket.items_added && ticket.items_added.length > 0) {
      itemsList = '<ul class="items-added-list">' + ticket.items_added.map(i => '<li>' + escHtml(i.name) + ' <em>(' + escHtml(i.category) + ')</em></li>').join('') + '</ul>';
    }
    rightPanel = '<div class="form-section">'
      + '<div class="processed-banner"><strong>' + (labels[ticket.status] || ticket.status) + '</strong>'
      + (ticket.note ? '<br>' + escHtml(ticket.note) : '')
      + (itemsList ? '<br>' + itemsList : '')
      + '</div>'
      + (ticket.status === 'processed' ? '' : '<div style="margin-top:12px"><button onclick="reopenTicket(\'' + ticket.id + '\')">Remettre en attente</button></div>')
      + '</div>';
  } else {
    // Editable form
    rightPanel = '<div class="form-section">'
      + '<div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:4px">Produits à ajouter au stock</div>'
      + '<div class="items-list" id="items-list"><div class="item-row">' + buildItemRow(0) + '</div></div>'
      + '<button class="add-item-btn" onclick="addItemRow()">+ Ajouter un produit</button>'
      + '<div>'
      + '<label style="margin-top:4px">Note admin (optionnel)</label>'
      + '<textarea class="note-input" id="admin-note" placeholder="Commentaire interne..."></textarea>'
      + '</div>'
      + '<div class="action-row">'
      + '<button id="btn-process" onclick="processTicket()">Valider et ajouter au stock</button>'
      + '<button class="danger" onclick="dismissTicket()">Ignorer</button>'
      + '</div>'
      + '<div id="modal-result"></div>'
      + '</div>';
  }

  body.innerHTML = '<div>' + imgHtml + '</div>' + rightPanel;
  initItemRows();
}

let itemCount = 1;

const ZONES = [{k:'frigo',l:'❄️ Frigo'},{k:'placard',l:'🏠 Placard'},{k:'congelateur',l:'🧊 Congélo'}];

function buildItemRow(idx) {
  return '<div class="item-row-top">'
    + '<input type="text" id="item-name-' + idx + '" placeholder="Nom du produit" oninput="syncItems()">'
    + '<button class="remove-btn" onclick="removeItemRow(' + idx + ')">×</button>'
    + '</div>'
    + '<div class="cats" id="cats-' + idx + '">'
    + CATS.map(c => '<button class="cat-btn' + (c === 'autres' ? ' active' : '') + '" data-cat="' + c + '" data-idx="' + idx + '" onclick="selectCat(this)">' + c + '</button>').join('')
    + '</div>'
    + '<div class="cats" id="zones-' + idx + '" style="margin-top:4px">'
    + ZONES.map((z,i) => '<button class="cat-btn' + (i===0?' active':'') + '" data-zone="' + z.k + '" data-idx="' + idx + '" onclick="selectZone(this)">' + z.l + '</button>').join('')
    + '</div>'
    + '<input class="expiry-input" id="item-expiry-' + idx + '" type="text" placeholder="DLC YYYY-MM-DD (optionnel)">';
}

function initItemRows() { itemCount = 1; }

function addItemRow() {
  const list = document.getElementById('items-list');
  const div = document.createElement('div');
  div.className = 'item-row';
  div.id = 'item-row-' + itemCount;
  div.innerHTML = buildItemRow(itemCount);
  list.appendChild(div);
  itemCount++;
}

function removeItemRow(idx) {
  const row = document.getElementById('item-row-' + idx);
  if (row) row.remove();
}

function selectCat(btn) {
  const idx = btn.dataset.idx;
  document.querySelectorAll('#cats-' + idx + ' .cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function selectZone(btn) {
  const idx = btn.dataset.idx;
  document.querySelectorAll('#zones-' + idx + ' .cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function syncItems() {}

function collectItems() {
  const items = [];
  for (let i = 0; i < itemCount + 10; i++) {
    const nameEl = document.getElementById('item-name-' + i);
    if (!nameEl) continue;
    const name = nameEl.value.trim();
    if (!name) continue;
    const activeCat = document.querySelector('#cats-' + i + ' .cat-btn.active');
    const category = activeCat ? activeCat.dataset.cat : 'autres';
    const activeZone = document.querySelector('#zones-' + i + ' .cat-btn.active');
    const storageZone = activeZone ? activeZone.dataset.zone : 'frigo';
    const expiryEl = document.getElementById('item-expiry-' + i);
    const expiry = expiryEl ? expiryEl.value.trim() : '';
    items.push({ name, category, storageZone, expiry_date: expiry || null });
  }
  return items;
}

async function processTicket() {
  const items = collectItems();
  if (items.length === 0) {
    document.getElementById('modal-result').innerHTML = '<div class="result error">Ajoutez au moins un produit.</div>';
    return;
  }
  const note = (document.getElementById('admin-note') || {}).value || '';
  const btn = document.getElementById('btn-process');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Traitement...';
  try {
    const r = await fetch('/api/admin/receipt-tickets/' + currentTicketId + '/process', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({items, note})
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || JSON.stringify(data));
    document.getElementById('modal-result').innerHTML = '<div class="result success"><strong>' + data.items_added + ' produit(s) ajouté(s) au stock.</strong></div>';
    setTimeout(() => { closeModal(); loadTickets(); }, 1500);
  } catch(e) {
    document.getElementById('modal-result').innerHTML = '<div class="result error">Erreur : ' + e.message + '</div>';
    btn.disabled = false;
    btn.textContent = 'Valider et ajouter au stock';
  }
}

async function dismissTicket() {
  if (!confirm('Ignorer ce ticket ? Il sera marqué comme ignoré.')) return;
  try {
    const r = await fetch('/api/admin/receipt-tickets/' + currentTicketId + '/dismiss', {
      method: 'POST',
      headers: {'Authorization':'Bearer '+token}
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Erreur'); }
    closeModal();
    loadTickets();
  } catch(e) {
    alert('Erreur : ' + e.message);
  }
}

async function reopenTicket(ticketId) {
  if (!confirm('Remettre ce ticket en attente ?')) return;
  try {
    const r = await fetch('/api/admin/receipt-tickets/' + ticketId + '/reopen', {
      method: 'POST',
      headers: {'Authorization':'Bearer '+token}
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Erreur'); }
    closeModal();
    loadTickets();
  } catch(e) {
    alert('Erreur : ' + e.message);
  }
}

function closeModal(event) {
  if (event && event.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').style.display = 'none';
  currentTicketId = null;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
</script>
</body>
</html>"""


ADMIN_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeepEat — Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#1a1a1a;min-height:100vh}
  .header{background:#16a34a;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;font-weight:700}
  .header nav{display:flex;gap:8px;margin-left:auto;align-items:center}
  .header nav a{color:#fff;font-size:13px;opacity:.8;text-decoration:none;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3)}
  .header nav a:hover{opacity:1;background:rgba(255,255,255,.15)}
  .logged-as{font-size:12px;color:rgba(255,255,255,.75);margin-right:4px}
  a.logout{font-size:12px;color:#fca5a5;cursor:pointer;text-decoration:underline}
  .container{max-width:1100px;margin:28px auto;padding:0 16px;display:flex;flex-direction:column;gap:16px}
  .card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:24px}
  .card-title{font-size:15px;font-weight:700;color:#166534;margin-bottom:14px}
  label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
  input[type=email],input[type=password]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none}
  input:focus{border-color:#16a34a;box-shadow:0 0 0 2px #bbf7d0}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;transition:.15s}
  button:hover{background:#15803d}
  button.secondary{background:#fff;color:#374151;border:1px solid #d1d5db}
  button.secondary:hover{background:#f9fafb}
  .result{border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.6;margin-top:12px}
  .result.error{background:#fef2f2;border:1px solid #fca5a5;color:#dc2626}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:4px}
  .stat{background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;padding:12px 14px}
  .stat-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px}
  .stat-value{font-size:20px;font-weight:800;color:#111827;line-height:1.2}
  .stat-sub{font-size:11px;color:#9ca3af;margin-top:2px}
  .health-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
  .health-item{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#fafafa;font-size:13px}
  .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .ok{background:#16a34a}
  .warn{background:#f59e0b}
  .err{background:#ef4444}
  .uptime-bar{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:9px 14px;font-size:13px;color:#166534;display:flex;gap:20px;flex-wrap:wrap;margin-top:10px}
  .error-banner{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:9px 14px;font-size:12px;color:#dc2626;margin-top:8px}
  .error-banner.critical{background:#7f1d1d;border-color:#991b1b;color:#fee2e2}
  .api-table{width:100%;border-collapse:collapse;font-size:12px}
  .api-table th{text-align:left;padding:7px 10px;background:#f0fdf4;color:#166534;font-weight:700;border-bottom:1px solid #d1fae5}
  .api-table td{padding:6px 10px;border-bottom:1px solid #f3f4f6;color:#374151;word-break:break-all}
  .api-table tr:last-child td{border-bottom:none}
  .api-table tr:hover td{background:#f9fafb}
  .rate-high{color:#ef4444;font-weight:700}
  .rate-critical{color:#7f1d1d;font-weight:800}
  .rate-med{color:#f59e0b;font-weight:700}
  .rate-ok{color:#16a34a}
  .svc-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px}
  .svc-row:last-child{border-bottom:none}
  .svc-name{flex:1;font-weight:600;color:#374151}
  .svc-units{color:#6b7280;font-size:12px}
  .svc-cost{font-weight:700;color:#166534;min-width:60px;text-align:right}
  .quota-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
  .quota-card{border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#fafafa}
  .quota-title{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#111827;margin-bottom:6px}
  .quota-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.03em;text-transform:uppercase}
  .quota-chip.ok{background:#dcfce7;color:#166534}
  .quota-chip.warning{background:#fef3c7;color:#92400e}
  .quota-chip.critical{background:#fee2e2;color:#991b1b}
  .quota-chip.unknown{background:#e5e7eb;color:#374151}
  .quota-row{font-size:12px;color:#374151;line-height:1.6;word-break:break-word}
  .quota-row.muted{color:#6b7280}
  .quota-bar{height:8px;border-radius:999px;background:#e5e7eb;overflow:hidden;margin:6px 0 8px}
  .quota-fill{height:100%;border-radius:999px}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:680px){.two-col{grid-template-columns:1fr}.stats-grid{grid-template-columns:repeat(2,1fr)}}
  .refresh-note{font-size:11px;color:#9ca3af;text-align:right}
  #login-section{display:block}
  #dashboard-section{display:none}
  .chart-card{background:#fff;border-radius:12px;border:1px solid #d1fae5;padding:20px}
  .chart-card .card-title{font-size:14px;font-weight:700;color:#166534;margin-bottom:12px}
  .period-bar{display:flex;align-items:center;gap:6px;margin-bottom:16px;flex-wrap:wrap}
  .period-btn{padding:4px 14px;border-radius:999px;border:1.5px solid #d1d5db;background:#fff;font-size:12px;font-weight:700;color:#6b7280;cursor:pointer;transition:.15s}
  .period-btn:hover{border-color:#16a34a;color:#166534}
  .period-btn.active{border-color:#16a34a;background:#f0fdf4;color:#166534}
  .drill-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center;padding:24px}
  .drill-box{background:#fff;border-radius:16px;width:100%;max-width:600px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18)}
  .drill-header{background:#f0fdf4;padding:14px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #d1fae5}
  .drill-title{font-size:12px;font-weight:800;color:#111827;flex:1;font-family:monospace;word-break:break-all}
  .drill-body{padding:20px;max-height:400px;overflow-y:auto}
  .flow-card{border-radius:10px;border:1px solid #e5e7eb;padding:12px}
  .flow-card.critical{border-color:#991b1b;background:#fef2f2}
  .flow-card.degraded{border-color:#f59e0b;background:#fffbeb}
  .flow-card.ok{border-color:#86efac;background:#f0fdf4}
  .severity-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.03em;text-transform:uppercase}
  .severity-badge.ok{background:#dcfce7;color:#166534}
  .severity-badge.degraded{background:#fef3c7;color:#92400e}
  .severity-badge.critical{background:#fee2e2;color:#991b1b}
  .danger-card{background:#fff5f5;border:1.5px solid #fca5a5;border-radius:14px;padding:18px 22px;margin-top:24px}
  .danger-card .card-title{color:#991b1b}
  .btn-danger{background:#dc2626;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer}
  .btn-danger:hover{background:#b91c1c}
  #reset-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center}
  #reset-modal.open{display:flex}
  .reset-modal-box{background:#fff;border-radius:14px;padding:28px 32px;min-width:340px;max-width:460px;box-shadow:0 8px 32px rgba(0,0,0,.18)}
  .reset-modal-box h3{margin:0 0 10px;color:#991b1b;font-size:16px}
  .reset-modal-box p{font-size:13px;color:#374151;margin:0 0 16px}
  .reset-modal-box input{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:16px}
  .reset-modal-actions{display:flex;gap:10px;justify-content:flex-end}
</style>
</head>
<body>
<div class="header">
  <span>📊</span>
  <h1>KeepEat — Dashboard</h1>
  <nav>
    <a href="/admin/tickets">Tickets</a>
    <a href="/admin/recipes">Recettes</a>
    <span id="logged-info" class="logged-as" style="display:none"></span>
    <a id="btn-logout" class="logout" style="display:none" onclick="logout()">Déconnexion</a>
  </nav>
</div>
<div class="container">

  <!-- LOGIN -->
  <div class="card" id="login-section">
    <h2 style="font-size:15px;font-weight:700;color:#166534;margin-bottom:16px">Connexion admin</h2>
    <div class="row" style="margin-bottom:12px">
      <div><label>Email</label><input id="email" type="email" placeholder="admin@example.com" autocomplete="username"></div>
      <div><label>Mot de passe</label><input id="password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
    </div>
    <button onclick="doLogin()">Se connecter</button>
    <div id="login-result"></div>
  </div>

  <!-- DASHBOARD -->
  <div id="dashboard-section">

    <!-- Filtre période -->
    <div class="period-bar">
      <span style="font-size:12px;color:#6b7280;font-weight:600">Période :</span>
      <button class="period-btn" data-days="1"  onclick="setDays(1)">24h</button>
      <button class="period-btn active" data-days="7"  onclick="setDays(7)">7j</button>
      <button class="period-btn" data-days="30" onclick="setDays(30)">30j</button>
      <button class="period-btn" data-days="90" onclick="setDays(90)">90j</button>
    </div>

    <!-- Santé système -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="card-title" style="margin:0">🔍 Santé système</div>
        <button class="secondary" onclick="loadAll()" style="padding:7px 14px;font-size:13px">Actualiser</button>
      </div>
      <div id="health-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- KPIs utilisateurs + abonnements -->
    <div class="two-col">
      <div class="card">
        <div class="card-title">👥 Utilisateurs</div>
        <div id="users-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
      <div class="card">
        <div class="card-title">💳 Abonnements</div>
        <div id="subscriptions-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🚀 Version frontend / Déploiement</div>
      <div id="frontend-deploy-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- Top issues API + coûts services -->
    <div class="two-col">
      <div class="card">
        <div class="card-title">⚠️ Top endpoints en erreur <small id="api-window-label" style="font-weight:400;color:#9ca3af;font-size:11px">(7j)</small></div>
        <div id="api-issues-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
      <div class="card">
        <div class="card-title">💰 Coûts services <small style="font-weight:400;color:#9ca3af;font-size:11px">(30j)</small></div>
        <div id="services-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
      </div>
    </div>

    <!-- Quotas services externes -->
    <div class="card">
      <div class="card-title">🧩 Services externes & limites</div>
      <div id="quotas-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- Flows métier critiques -->
    <div class="card">
      <div class="card-title">🎯 Flux métier critiques</div>
      <div id="critical-flows-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- Funnel produit -->
    <div class="card">
      <div class="card-title">🧭 Funnel produit</div>
      <div id="funnel-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- Funnel d'activation -->
    <div class="card">
      <div class="card-title">🚀 Entonnoir d'activation (nouveaux inscrits)</div>
      <div id="activation-funnel-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- Crash reports frontend -->
    <div class="card">
      <div class="card-title">💥 Crashes frontend</div>
      <div id="crash-reports-content"><div style="color:#9ca3af;font-size:13px">Chargement...</div></div>
    </div>

    <!-- Graphiques de tendance -->
    <div class="two-col">
      <div class="chart-card">
        <div class="card-title">📈 Utilisateurs actifs / jour <small id="trend-window-label-1" style="font-weight:400;color:#9ca3af;font-size:11px">(7j)</small></div>
        <canvas id="chart-dau" height="140"></canvas>
      </div>
      <div class="chart-card">
        <div class="card-title">🆕 Nouveaux utilisateurs / jour <small id="trend-window-label-2" style="font-weight:400;color:#9ca3af;font-size:11px">(7j)</small></div>
        <canvas id="chart-new-users" height="140"></canvas>
      </div>
    </div>
    <div class="two-col">
      <div class="chart-card">
        <div class="card-title">⚠️ Erreurs API / jour <small id="trend-window-label-3" style="font-weight:400;color:#9ca3af;font-size:11px">(7j)</small></div>
        <canvas id="chart-errors" height="140"></canvas>
      </div>
      <div class="chart-card">
        <div class="card-title">💰 Coûts services / jour <small id="trend-window-label-4" style="font-weight:400;color:#9ca3af;font-size:11px">(7j)</small></div>
        <canvas id="chart-costs" height="140"></canvas>
      </div>
    </div>

    <!-- Zone Danger -->
    <div class="danger-card">
      <div class="card-title">⚠️ Zone Danger</div>
      <p style="font-size:13px;color:#6b7280;margin:0 0 12px">Ces actions sont irréversibles. Une confirmation de mot de passe est requise.</p>
      <button class="btn-danger" onclick="openResetModal()">🗑 Réinitialiser les logs API</button>
      <div id="reset-result" style="margin-top:10px;font-size:13px"></div>
    </div>

    <div class="refresh-note" id="last-updated"></div>
  </div>
</div>

<!-- RESET LOGS MODAL -->
<div id="reset-modal">
  <div class="reset-modal-box">
    <h3>⚠️ Confirmer la réinitialisation</h3>
    <p>Cette action supprimera <strong>tous les logs API</strong> de la base de données. Elle est irréversible. Entrez votre mot de passe pour confirmer.</p>
    <input type="password" id="reset-confirm-pwd" placeholder="Votre mot de passe admin" />
    <div class="reset-modal-actions">
      <button onclick="closeResetModal()" style="background:#f3f4f6;border:none;border-radius:8px;padding:9px 18px;font-size:13px;cursor:pointer">Annuler</button>
      <button class="btn-danger" onclick="doResetApiLogs()" id="btn-confirm-reset">Confirmer</button>
    </div>
    <div id="reset-modal-error" style="color:#dc2626;font-size:12px;margin-top:8px"></div>
  </div>
</div>

<!-- DRILL-DOWN MODAL -->
<div class="drill-overlay" id="drill-overlay" onclick="closeDrill(event)">
  <div class="drill-box">
    <div class="drill-header">
      <span class="drill-title" id="drill-title"></span>
      <button onclick="closeDrill()" style="background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;line-height:1;padding:0 2px">×</button>
    </div>
    <div class="drill-body" id="drill-body">
      <div style="color:#9ca3af;font-size:13px">Chargement...</div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
<script>
let token = localStorage.getItem('keepeat_admin_token');
let userEmail = localStorage.getItem('keepeat_admin_email');
let refreshTimer = null;
let _charts = {};
let selectedDays = 7;
let _apiIssueKeys = [];
const allowedDays = new Set([1, 7, 30, 90]);

function setDays(d) {
  const nextDays = Number(d);
  selectedDays = allowedDays.has(nextDays) ? nextDays : 7;
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.days) === selectedDays);
  });
  updateWindowLabels();
  loadAll();
}

function updateWindowLabels() {
  const labels = ['api-window-label', 'trend-window-label-1', 'trend-window-label-2', 'trend-window-label-3', 'trend-window-label-4'];
  labels.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '(' + selectedDays + 'j)';
  });
}

if (token) showDashboardSection();
updateWindowLabels();

function showDashboardSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
  const info = document.getElementById('logged-info');
  info.textContent = userEmail || 'admin';
  info.style.display = 'inline';
  document.getElementById('btn-logout').style.display = 'inline';
  loadAll();
  if (!refreshTimer) refreshTimer = setInterval(loadAll, 60000);
}

async function doLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const res = document.getElementById('login-result');
  if (!email || !password) { res.innerHTML = '<div class="result error">Email et mot de passe requis.</div>'; return; }
  try {
    const r = await fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data = await r.json();
    if (!r.ok) { res.innerHTML = '<div class="result error">' + (data.detail || 'Identifiants incorrects.') + '</div>'; return; }
    token = data.access_token;
    localStorage.setItem('keepeat_admin_token', token);
    localStorage.setItem('keepeat_admin_email', email);
    userEmail = email;
    showDashboardSection();
  } catch(e) { res.innerHTML = '<div class="result error">Erreur réseau : ' + e.message + '</div>'; }
}

function logout() {
  clearInterval(refreshTimer); refreshTimer = null;
  localStorage.removeItem('keepeat_admin_token');
  localStorage.removeItem('keepeat_admin_email');
  token = null;
  document.getElementById('login-section').style.display = 'block';
  document.getElementById('dashboard-section').style.display = 'none';
  document.getElementById('logged-info').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
}

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setBlockError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<div class="error-banner">⚠️ ' + escHtml(message || 'Erreur de chargement.') + '</div>';
}

async function apiFetch(path) {
  const r = await fetch(path, {headers:{'Authorization':'Bearer '+token}});
  const raw = await r.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (_err) {
    payload = null;
  }
  if (r.status === 401) {
    logout();
    throw new Error('Session expirée. Merci de vous reconnecter.');
  }
  if (!r.ok) {
    const detail = payload && typeof payload === 'object'
      ? (payload.detail || payload.message || payload.error)
      : null;
    throw new Error((detail ? String(detail) : 'HTTP ' + r.status));
  }
  if (payload === null) {
    throw new Error('Réponse JSON invalide pour ' + path);
  }
  return payload;
}

async function loadAll() {
  const [healthResult, dashResult, trendsResult] = await Promise.allSettled([
    apiFetch('/api/admin/monitoring/health?days=' + selectedDays),
    apiFetch('/api/admin/monitoring/dashboard?days=' + selectedDays),
    loadTrends(),
  ]);

  if (healthResult.status === 'fulfilled') {
    renderHealth(healthResult.value);
  } else {
    setBlockError('health-content', 'Erreur de chargement de la santé système : ' + healthResult.reason.message);
  }

  if (dashResult.status === 'fulfilled') {
    const dash = dashResult.value || {};
    renderUsers(dash.users || {});
    renderSubscriptions(dash.subscriptions || {}, dash.estimated_cost_summary || {});
    renderFrontendDeployment(dash.frontend_deployment || {});
    renderApiIssues(Array.isArray(dash.top_api_issues) ? dash.top_api_issues : [], selectedDays);
    renderServices(Array.isArray(dash.top_service_usage) ? dash.top_service_usage : []);
    renderCriticalFlows(dash.critical_flows || {});
    renderFunnel(dash.product_funnel || {});
    renderActivationFunnel(dash.activation_funnel || {});
    renderCrashReports(dash.crash_reports || {});
    renderCostMetrics(dash.cost_metrics || {});
    renderOcrImageEnrichment(dash.ocr_image_enrichment || {});
    renderExternalServiceQuotas(dash.external_service_quotas || null);
  } else {
    const msg = 'Erreur de chargement du dashboard : ' + dashResult.reason.message;
    setBlockError('users-content', msg);
    setBlockError('subscriptions-content', msg);
    setBlockError('frontend-deploy-content', msg);
    setBlockError('api-issues-content', msg);
    setBlockError('services-content', msg);
    setBlockError('quotas-content', msg);
    setBlockError('critical-flows-content', msg);
    setBlockError('funnel-content', msg);
    setBlockError('activation-funnel-content', msg);
    setBlockError('crash-reports-content', msg);
  }

  if (trendsResult.status === 'rejected') {
    const msg = 'Erreur de chargement des tendances : ' + trendsResult.reason.message;
    ['chart-dau', 'chart-new-users', 'chart-errors', 'chart-costs'].forEach((id) => {
      const canvas = document.getElementById(id);
      if (!canvas || !canvas.parentElement) return;
      canvas.parentElement.innerHTML = '<div class="error-banner">' + escHtml(msg) + '</div>';
    });
  }

  document.getElementById('last-updated').textContent = 'Mis à jour : ' + new Date().toLocaleTimeString('fr-FR') + ' (' + selectedDays + 'j)';
}

async function loadTrends() {
  const data = await apiFetch('/api/admin/monitoring/trends?days=' + selectedDays);
  renderChart('chart-dau',       'line', Array.isArray(data.dau) ? data.dau : [],       r => r.date, r => r.count, 'Actifs/j',   '#16a34a');
  renderChart('chart-new-users', 'bar',  Array.isArray(data.new_users) ? data.new_users : [], r => r.date, r => r.count, 'Nouveaux/j', '#3b82f6');
  renderChart('chart-errors',    'bar',  Array.isArray(data.errors) ? data.errors : [],    r => r.date, r => r.count, 'Erreurs/j',  '#ef4444');
  renderChart('chart-costs',     'line', Array.isArray(data.costs) ? data.costs : [],     r => r.date, r => r.cost,  'Coût €/j',   '#f59e0b');
}

function renderChart(id, type, rows, getLabel, getValue, label, color) {
  const labels = (rows || []).map(getLabel);
  const values = (rows || []).map(getValue);
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  const ctx = document.getElementById(id);
  if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: color,
        backgroundColor: type === 'bar' ? color + 'bb' : color + '22',
        borderWidth: 2,
        tension: 0.3,
        fill: type === 'line',
        pointRadius: labels.length > 20 ? 2 : 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 }, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
}

function fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'min ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'min';
}

function renderHealth(h) {
  if (!h || typeof h !== 'object' || !h.db || typeof h.db.ok !== 'boolean') {
    setBlockError('health-content', 'Réponse santé système invalide.');
    return;
  }
  const externalServices = (h.external_services && typeof h.external_services === 'object') ? h.external_services : {};
  const svcLabels = {
    gemini_ocr_configured: 'Gemini OCR',
    gemini_recipes_configured: 'Gemini Recettes',
    brevo_configured: 'Brevo (email)',
    openfoodfacts_configured: 'OpenFoodFacts',
  };
  let html = '<div class="health-grid">';
  html += '<div class="health-item"><span class="dot ' + (h.db.ok ? 'ok' : 'err') + '"></span>MongoDB : ' + (h.db.ok ? 'OK' : 'ERREUR') + '</div>';
  for (const [k, lbl] of Object.entries(svcLabels)) {
    const on = externalServices[k];
    html += '<div class="health-item"><span class="dot ' + (on ? 'ok' : 'warn') + '"></span>' + lbl + ' : ' + (on ? 'Configuré' : 'Non configuré') + '</div>';
  }
  html += '</div>';
  const statusLabel = h.status === 'critical' ? '⛔ CRITIQUE' : (h.status === 'degraded' ? '⚠ DÉGRADÉ' : '✓ OK');
  const statusColor = h.status === 'critical' ? '#991b1b' : (h.status === 'degraded' ? '#f59e0b' : '#16a34a');
  html += '<div class="uptime-bar"><span>⏱ Uptime : <strong>' + fmtUptime(h.uptime_seconds) + '</strong></span>';
  html += '<span>Statut global (' + (h.days || selectedDays) + 'j) : <strong style="color:' + statusColor + '">' + statusLabel + '</strong></span></div>';
  if (Array.isArray(h.status_reasons) && h.status_reasons.length) {
    html += '<div style="font-size:11px;color:#6b7280;margin-top:8px">Raisons: ' + h.status_reasons.map(escHtml).join(' · ') + '</div>';
  }
  if (h.last_critical_error) {
    const e = h.last_critical_error;
    html += '<div class="error-banner critical">⛔ Dernière erreur critique : <strong>' + escHtml((e.method||'') + ' ' + (e.path||'')) + '</strong> → HTTP ' + (e.status_code||'') + ' — ' + escHtml(e.error_type||'unknown') + ' · Sévérité CRITIQUE · ' + escHtml((e.created_at||'').replace('T',' ').slice(0,19)) + '</div>';
  }
  document.getElementById('health-content').innerHTML = html;
}

function statCard(label, value, sub) {
  return '<div class="stat"><div class="stat-label">' + escHtml(String(label)) + '</div><div class="stat-value">' + escHtml(String(value)) + '</div>' + (sub ? '<div class="stat-sub">' + escHtml(sub) + '</div>' : '') + '</div>';
}

function renderUsers(u) {
  if (!u || typeof u !== 'object') {
    setBlockError('users-content', 'Données utilisateurs indisponibles.');
    return;
  }
  document.getElementById('users-content').innerHTML =
    '<div class="stats-grid">'
    + statCard('Total', u.total, '')
    + statCard('Nouveaux 24h', u.new_today, '')
    + statCard('Nouveaux 7j', u.new_7d, '')
    + statCard('Nouveaux 30j', u.new_30d, '')
    + statCard('DAU', u.dau, 'actifs/j')
    + statCard('WAU', u.wau, 'actifs/sem')
    + statCard('Premium', u.premium, '')
    + '</div>';
}

function renderSubscriptions(s, cost) {
  if (!s || typeof s !== 'object') {
    setBlockError('subscriptions-content', 'Données abonnements indisponibles.');
    return;
  }
  const byPlan = (s.by_plan && typeof s.by_plan === 'object') ? s.by_plan : {};
  const costVal = cost ? cost.services_30d_estimated_cost_eur : null;
  document.getElementById('subscriptions-content').innerHTML =
    '<div class="stats-grid">'
    + statCard('Actifs', s.active, '')
    + statCard('MRR', (s.estimated_mrr_eur||0).toFixed(2) + '\u00a0€', '')
    + statCard('ARR', (s.estimated_arr_eur||0).toFixed(2) + '\u00a0€', '')
    + (costVal !== null ? statCard('Coûts 30j', costVal.toFixed(4) + '\u00a0€', 'estimé') : '')
    + '</div>'
    + '<div style="font-size:12px;color:#6b7280;margin-top:8px">Mensuel : ' + (byPlan.premium_monthly||0) + ' · Autre : ' + (byPlan.premium_other||0) + '</div>';
}

function frontendDeployStatusLabel(status) {
  if (status === 'up_to_date') return 'OK / Up to date';
  if (status === 'mismatch') return 'Warning / Mismatch';
  if (status === 'deployment_check') return 'Déploiement à vérifier';
  return 'Unknown';
}

function frontendDeployStatusClass(status) {
  if (status === 'up_to_date') return 'ok';
  if (status === 'mismatch' || status === 'deployment_check') return 'warn';
  return 'err';
}

function frontendValue(v) {
  return (v === null || v === undefined || v === '' || v === 'unknown') ? '—' : String(v);
}

function renderFrontendDeployment(meta) {
  const status = meta && typeof meta === 'object' ? (meta.status || 'unknown') : 'unknown';
  const source = meta && typeof meta === 'object' ? (meta.source || 'unknown') : 'unknown';
  const current = (meta && typeof meta.current === 'object') ? meta.current : {};
  const expected = (meta && typeof meta.expected === 'object') ? meta.expected : {};
  const statusClass = frontendDeployStatusClass(status);
  const statusText = frontendDeployStatusLabel(status);
  const message = meta && typeof meta.message === 'string' && meta.message ? meta.message : 'Métadonnées de version frontend indisponibles.';
  let html = '<div class="health-grid">';
  html += '<div class="health-item"><span class="dot ' + statusClass + '"></span><strong>Statut :</strong>&nbsp;' + escHtml(statusText) + '</div>';
  html += '<div class="health-item"><span class="dot ok"></span><strong>Frontend actuel :</strong>&nbsp;<code>' + escHtml(frontendValue(current.commit)) + '</code></div>';
  html += '<div class="health-item"><span class="dot ' + (status === 'mismatch' ? 'warn' : 'ok') + '"></span><strong>Dernier deploy connu :</strong>&nbsp;<code>' + escHtml(frontendValue(expected.commit)) + '</code></div>';
  html += '</div>';
  html += '<div style="font-size:12px;color:#374151;line-height:1.8;margin-top:10px">';
  html += '<div><strong>Source frontend actuel :</strong> ' + escHtml(frontendValue(current.source)) + '</div>';
  html += '<div><strong>Source dernier deploy :</strong> ' + escHtml(frontendValue(expected.source)) + '</div>';
  html += '<div><strong>Source de comparaison :</strong> ' + escHtml(frontendValue(source)) + '</div>';
  html += '<div><strong>Version frontend actuelle :</strong> ' + escHtml(frontendValue(current.version)) + '</div>';
  html += '<div><strong>Build frontend actuel :</strong> ' + escHtml(frontendValue(current.build_time)) + '</div>';
  html += '<div><strong>Deploy ID actuel :</strong> ' + escHtml(frontendValue(current.deploy_id)) + ' · <strong>Service ID :</strong> ' + escHtml(frontendValue(current.service_id)) + '</div>';
  html += '<div><strong>Version/deploy attendu :</strong> ' + escHtml(frontendValue(expected.version)) + ' · <strong>Deploy ID attendu :</strong> ' + escHtml(frontendValue(expected.deploy_id)) + '</div>';
  html += '<div><strong>Build attendu :</strong> ' + escHtml(frontendValue(expected.build_time)) + ' · <strong>Dernier deploy time :</strong> ' + escHtml(frontendValue(expected.deploy_time)) + '</div>';
  html += '</div>';
  html += '<div class="error-banner" style="margin-top:10px;background:#f0fdf4;border-color:#bbf7d0;color:#166534">' + escHtml(message) + '</div>';
  document.getElementById('frontend-deploy-content').innerHTML = html;
}

function severityClass(level) {
  if (level === 'critical') return 'rate-critical';
  if (level === 'degraded') return 'rate-med';
  return 'rate-ok';
}

function renderApiIssues(issues, days) {
  _apiIssueKeys = (issues || []).map(r => r.endpoint_key || '');
  if (!issues.length) {
    document.getElementById('api-issues-content').innerHTML = '<div style="color:#16a34a;font-size:13px">Aucun problème détecté 🎉</div>';
    return;
  }
  let html = '<table class="api-table"><thead><tr><th>Endpoint</th><th>Appels</th><th>Tx erreur</th><th>Erreurs</th><th>Lat. moy.</th><th>Criticité</th><th>Dernière erreur</th></tr></thead><tbody>';
  for (let i = 0; i < issues.length; i++) {
    const row = issues[i];
    const rate = row.error_rate || 0;
    const cls = severityClass(row.severity);
    const lastErr = row.last_error && row.last_error.created_at ? row.last_error.created_at.replace('T',' ').slice(0,19) : '—';
    html += '<tr style="cursor:pointer" title="Cliquer pour détails" onclick="drillDown(' + i + ')">';
    html += '<td>' + escHtml(row.endpoint_key||'') + '</td><td>' + (row.calls||row.volume||0) + '</td><td class="' + cls + '">' + (rate*100).toFixed(1) + '%</td><td>' + (row.errors||Math.round(rate * (row.calls||row.volume||0))) + '</td><td>' + (row.avg_latency_ms ? Math.round(row.avg_latency_ms) + 'ms' : '—') + '</td><td><span class="severity-badge ' + escHtml(row.severity||'ok') + '">' + escHtml(row.severity||'ok') + '</span></td><td>' + escHtml(lastErr) + '</td></tr>';
  }
  html += '</tbody></table><div style="font-size:11px;color:#9ca3af;margin-top:4px">Période ' + days + 'j · trié par sévérité puis impact. Cliquer sur une ligne pour le détail</div>';
  document.getElementById('api-issues-content').innerHTML = html;
}

function renderCriticalFlows(flowsObj) {
  const flows = Object.values(flowsObj || {});
  if (!flows.length) {
    document.getElementById('critical-flows-content').innerHTML = '<div style="color:#9ca3af;font-size:13px">Aucune donnée.</div>';
    return;
  }
  let html = '<div class="two-col">';
  for (const row of flows) {
    const severity = row.severity || 'ok';
    html += '<div class="flow-card ' + escHtml(severity) + '">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>' + escHtml(row.label || row.endpoint_key || 'Flux') + '</strong><span class="severity-badge ' + escHtml(severity) + '">' + escHtml(severity) + '</span></div>';
    html += '<div style="font-size:12px;color:#374151;line-height:1.6">';
    html += 'Endpoint : <code>' + escHtml(row.endpoint_key || '—') + '</code><br>';
    html += 'Appels : <strong>' + (row.calls || 0) + '</strong> · Succès : <strong>' + (row.success || 0) + '</strong> · Erreurs : <strong>' + (row.errors || 0) + '</strong><br>';
    html += 'Tx erreur : <strong>' + (((row.error_rate || 0) * 100).toFixed(1)) + '%</strong> · Lat. moy : <strong>' + (row.avg_latency_ms ? Math.round(row.avg_latency_ms) + 'ms' : '—') + '</strong><br>';
    html += 'Dernière erreur : ' + escHtml(row.last_error && row.last_error.created_at ? row.last_error.created_at.replace('T',' ').slice(0,19) : '—') + '<br>';
    html += 'Type dominant : ' + escHtml(row.dominant_error_type || '—');
    html += '</div></div>';
  }
  html += '</div>';
  document.getElementById('critical-flows-content').innerHTML = html;
}

function renderFunnel(f) {
  document.getElementById('funnel-content').innerHTML =
    '<div class="stats-grid">'
    + statCard('Users scan ticket', f.users_with_receipt_scan || 0, 'période active')
    + statCard('Users ajout stock', f.users_with_stock_add || 0, 'POST /api/stock')
    + statCard('Users recettes', f.users_with_recipes_view || 0, 'suggestions + IA')
    + statCard('Conv. premium', (((f.premium_conversion_rate || 0) * 100).toFixed(1)) + '%', 'premium / total')
    + '</div>';
}

function renderActivationFunnel(a) {
  const registered = a.registered || 0;
  const rates = a.rates || {};
  const pct = (r) => ((r || 0) * 100).toFixed(1) + '%';
  const container = document.getElementById('activation-funnel-content');
  if (!registered) {
    container.innerHTML = '<div style="color:#9ca3af;font-size:13px">Aucun nouvel inscrit sur cette période.</div>';
    return;
  }
  const stages = [
    { label: 'Inscrits', count: registered, sub: '100%' },
    { label: 'Ont ajouté un produit', count: a.added_product || 0, sub: pct(rates.added_product) },
    { label: 'Ont scanné un ticket', count: a.scanned_receipt || 0, sub: pct(rates.scanned_receipt) },
    { label: 'Ont vu le paywall', count: a.viewed_paywall || 0, sub: pct(rates.viewed_paywall) },
    { label: 'Ont acheté', count: a.purchased || 0, sub: pct(rates.purchased) },
  ];
  container.innerHTML = '<div class="stats-grid">'
    + stages.map((s) => statCard(s.label, s.count, s.sub)).join('')
    + '</div>';
}

function renderCrashReports(c) {
  const total = c.total || 0;
  const recent = Array.isArray(c.recent) ? c.recent : [];
  const container = document.getElementById('crash-reports-content');
  if (!total) {
    container.innerHTML = '<div style="color:#16a34a;font-size:13px">Aucun crash remonté sur cette période 🎉</div>';
    return;
  }
  let html = '<div class="stats-grid">' + statCard('Crashes', total, 'période sélectionnée') + '</div>';
  html += '<table class="api-table" style="margin-top:8px"><thead><tr><th>Quand</th><th>Écran</th><th>Plateforme</th><th>Version</th><th>Message</th></tr></thead><tbody>';
  for (const r of recent) {
    const when = r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 19) : '—';
    html += '<tr><td>' + escHtml(when) + '</td><td>' + escHtml(r.screen || '—') + '</td><td>' + escHtml(r.platform || '—') + '</td><td>' + escHtml(r.app_version || '—') + '</td><td>' + escHtml(r.message || '—') + '</td></tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderOcrImageEnrichment(o) {
  const container = document.getElementById('services-content');
  if (!container) return;
  const itemsTotal = o.items_total || 0;
  const imagesFound = o.images_found_count || 0;
  const rate = o.images_found_rate === null || o.images_found_rate === undefined ? '—' : ((o.images_found_rate * 100).toFixed(1) + '%');
  let html = container.innerHTML;
  html += '<div style="border-top:1px solid #f3f4f6;margin-top:10px;padding-top:10px;font-size:12px;color:#374151;line-height:1.7">';
  html += '<div><strong>Images articles ticket OCR (' + selectedDays + 'j):</strong> ' + imagesFound + ' / ' + itemsTotal + ' articles (' + rate + ')</div>';
  html += '</div>';
  container.innerHTML = html;
}

function renderCostMetrics(c) {
  const container = document.getElementById('services-content');
  if (!container) return;
  let html = container.innerHTML;
  html += '<div style="border-top:1px solid #f3f4f6;margin-top:10px;padding-top:10px;font-size:12px;color:#374151;line-height:1.7">';
  html += '<div><strong>Coût OCR (' + selectedDays + 'j):</strong> ' + Number(c.ocr_cost_eur || 0).toFixed(4) + ' €</div>';
  html += '<div><strong>Coût moyen / scan:</strong> ' + (c.ocr_cost_per_scan_eur === null || c.ocr_cost_per_scan_eur === undefined ? '—' : Number(c.ocr_cost_per_scan_eur).toFixed(5) + ' €') + '</div>';
  html += '<div><strong>Coût moyen / utilisateur actif:</strong> ' + (c.cost_per_active_user_eur === null || c.cost_per_active_user_eur === undefined ? '—' : Number(c.cost_per_active_user_eur).toFixed(5) + ' €') + '</div>';
  html += '<div><strong>Net estimatif (MRR - OCR):</strong> ' + Number(c.estimated_net_revenue_eur || 0).toFixed(2) + ' €</div>';
  html += '</div>';
  container.innerHTML = html;
}

async function drillDown(idx) {
  const endpointKey = _apiIssueKeys[idx] || '';
  if (!endpointKey) return;
  const overlay = document.getElementById('drill-overlay');
  overlay.style.display = 'flex';
  document.getElementById('drill-title').textContent = endpointKey;
  document.getElementById('drill-body').innerHTML = '<div style="color:#9ca3af;font-size:13px">Chargement...</div>';
  const data = await apiFetch('/api/admin/monitoring/api-drill?endpoint_key=' + encodeURIComponent(endpointKey) + '&days=' + selectedDays);
  if (!data) { closeDrill(); return; }
  let html = '<div style="font-size:13px;color:#374151;margin-bottom:14px"><strong>' + data.total_calls + '</strong> appel(s) sur ' + data.days + 'j</div>';
  html += '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">Par code HTTP</div>';
  html += '<table class="api-table" style="margin-bottom:16px"><thead><tr><th>Status</th><th>Appels</th><th>Lat. moy.</th></tr></thead><tbody>';
  for (const r of data.by_status) {
    const cls = r.status_code >= 500 ? 'rate-high' : r.status_code >= 400 ? 'rate-med' : 'rate-ok';
    html += '<tr><td class="' + cls + '"><strong>' + r.status_code + '</strong></td><td>' + r.count + '</td><td>' + r.avg_ms + 'ms</td></tr>';
  }
  html += '</tbody></table>';
  if (data.last_errors && data.last_errors.length) {
    html += '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">Dernières erreurs</div>';
    for (const e of data.last_errors) {
      html += '<div style="font-size:11px;color:#6b7280;padding:5px 0;border-bottom:1px solid #f3f4f6;line-height:1.5">';
      html += escHtml((e.created_at||'').replace('T',' ').slice(0,19)) + '<br>';
      html += '<span style="color:#ef4444;font-family:monospace">' + escHtml((e.method||'') + ' ' + (e.path||'')) + '</span>';
      html += ' → HTTP <strong>' + (e.status_code||'') + '</strong>';
      if (e.error_type) html += ' <span style="color:#9ca3af">(' + escHtml(e.error_type) + ')</span>';
      if (e.duration_ms) html += ' — ' + Math.round(e.duration_ms) + 'ms';
      html += '</div>';
    }
  } else {
    html += '<div style="color:#16a34a;font-size:12px">Aucune erreur récente.</div>';
  }
  document.getElementById('drill-body').innerHTML = html;
}

function closeDrill(event) {
  if (event && event.target !== document.getElementById('drill-overlay')) return;
  document.getElementById('drill-overlay').style.display = 'none';
}

function renderServices(svcs) {
  if (!Array.isArray(svcs) || !svcs.length) {
    document.getElementById('services-content').innerHTML = '<div style="color:#9ca3af;font-size:13px">Aucune donnée.</div>';
    return;
  }
  let html = '<div>';
  for (const s of svcs) {
    html += '<div class="svc-row"><span class="svc-name">' + escHtml(s.service_name||'—') + '</span><span class="svc-units">' + Number(s.units||0).toFixed(0) + ' unités</span><span class="svc-cost">' + Number(s.estimated_cost||0).toFixed(4) + '\u00a0€</span></div>';
  }
  html += '</div>';
  document.getElementById('services-content').innerHTML = html;
}

function quotaStatusClass(status) {
  if (status === 'ok' || status === 'warning' || status === 'critical') return status;
  return 'unknown';
}

function quotaFillColor(status) {
  if (status === 'critical') return '#ef4444';
  if (status === 'warning') return '#f59e0b';
  if (status === 'ok') return '#16a34a';
  return '#9ca3af';
}

function quotaPeriodLabel(period) {
  if (period === 'day') return 'par jour';
  if (period === 'month') return 'par mois';
  if (period) return 'sur ' + period;
  return 'unknown';
}

function renderExternalServiceQuotas(payload) {
  const container = document.getElementById('quotas-content');
  if (!container) return;
  const list = payload && Array.isArray(payload.services) ? payload.services.filter((x) => x && typeof x === 'object') : [];
  if (!list.length) {
    container.innerHTML = '<div style="color:#6b7280;font-size:13px">Aucune donnée de quota disponible.</div>';
    return;
  }
  let html = '<div class="quota-list">';
  for (const service of list) {
    const status = quotaStatusClass(service.status);
    const usage = service.usage_current_period;
    const limit = service.quota_limit_value;
    const percentRaw = service.usage_percent;
    const percentNumber = typeof percentRaw === 'number' && Number.isFinite(percentRaw) ? percentRaw : null;
    const percentLabel = percentNumber === null ? 'unknown' : percentNumber.toFixed(2) + '%';
    const fillRatio = percentNumber === null ? 0 : Math.max(0, Math.min(percentNumber, 100));
    const usageRemaining = service.usage_remaining;
    const unit = service.quota_unit || '';
    html += '<div class="quota-card">';
    html += '<div class="quota-title"><span>' + escHtml(String(service.display_name || service.service_key || 'service')) + '</span>';
    html += '<span class="quota-chip ' + escHtml(status) + '">' + escHtml(status) + '</span></div>';
    html += '<div class="quota-row">Usage: <strong>' + escHtml(String(usage ?? 'unknown')) + '</strong> / <strong>' + escHtml(String(limit ?? 'unknown')) + '</strong> ' + escHtml(String(unit)) + '</div>';
    html += '<div class="quota-row">Période quota: <strong>' + escHtml(quotaPeriodLabel(service.quota_period)) + '</strong></div>';
    html += '<div class="quota-row">Restant: <strong>' + escHtml(String(usageRemaining ?? 'unknown')) + '</strong></div>';
    html += '<div class="quota-row">Consommation: <strong>' + escHtml(percentLabel) + '</strong></div>';
    html += '<div class="quota-bar"><div class="quota-fill" style="width:' + fillRatio + '%;background:' + quotaFillColor(status) + '"></div></div>';
    html += '<div class="quota-row muted">Source: ' + escHtml(String(service.source_of_truth || 'unknown')) + '</div>';
    html += '<div class="quota-row muted">Pricing: ' + escHtml(String(service.pricing_note || 'pricing unknown')) + '</div>';
    html += '<div class="quota-row muted">Upgrade: ' + escHtml(String(service.upgrade_note || 'à renseigner')) + '</div>';
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

document.getElementById('password').addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); });

function openResetModal() {
  document.getElementById('reset-confirm-pwd').value = '';
  document.getElementById('reset-modal-error').textContent = '';
  document.getElementById('reset-result').innerHTML = '';
  document.getElementById('reset-modal').classList.add('open');
  document.getElementById('reset-confirm-pwd').focus();
}

function closeResetModal() {
  document.getElementById('reset-modal').classList.remove('open');
}

async function doResetApiLogs() {
  const pwd = document.getElementById('reset-confirm-pwd').value;
  const errEl = document.getElementById('reset-modal-error');
  const btn = document.getElementById('btn-confirm-reset');
  if (!pwd) { errEl.textContent = 'Mot de passe requis.'; return; }
  btn.disabled = true;
  btn.textContent = 'Suppression...';
  errEl.textContent = '';
  try {
    const r = await fetch('/api/admin/monitoring/logs/api-requests', {
      method: 'DELETE',
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({confirm_password: pwd}),
    });
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.detail || 'Erreur ' + r.status; return; }
    closeResetModal();
    document.getElementById('reset-result').innerHTML = '<span style="color:#16a34a">\u2713 ' + (data.deleted_count || 0) + ' logs supprim\u00e9s.</span>';
    loadAll();
  } catch(e) {
    errEl.textContent = 'Erreur r\u00e9seau\u00a0: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmer';
  }
}

document.getElementById('reset-confirm-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doResetApiLogs(); });
</script>
</body>
</html>"""
