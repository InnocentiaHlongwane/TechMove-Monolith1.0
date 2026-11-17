// TechMove single-page front end. Talks only to the /api server, like the original MVC app.
const app = document.getElementById("app");
const nav = document.getElementById("nav");
const STATUSES = ["Draft", "Active", "Expired", "OnHold"];
const NEXT_STATUSES = { Draft: ["Active"], Active: ["OnHold", "Expired"], OnHold: ["Active"], Expired: [] };

// ---------- helpers ----------
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const zar = (n) => "R " + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDateTime = (d) => new Date(d).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
const today = () => new Date().toISOString().slice(0, 10);

const auth = {
  get token() { return localStorage.getItem("tm_token"); },
  get user() { return localStorage.getItem("tm_user"); },
  set(token, user) { localStorage.setItem("tm_token", token); localStorage.setItem("tm_user", user); },
  clear() { localStorage.removeItem("tm_token"); localStorage.removeItem("tm_user"); },
};

let flash = null;
const setFlash = (type, message) => (flash = { type, message });
const takeFlash = () => {
  const f = flash;
  flash = null;
  return f ? `<div class="alert ${f.type}">${esc(f.message)}</div>` : "";
};

class ApiError extends Error {}

async function api(path, { method = "GET", body, raw = false } = {}) {
  const headers = {};
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && path !== "/auth/login") {
    auth.clear();
    setFlash("error", "Please log in to continue.");
    sessionStorage.setItem("tm_return", location.hash);
    location.hash = "#/login";
    throw new ApiError("Unauthorized");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).message || message; } catch {}
    throw new ApiError(message);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const formError = (form, err) => {
  if (err.message === "Unauthorized") return;
  const box = form.querySelector(".form-error");
  box.hidden = false;
  box.textContent = err.message;
  form.querySelectorAll("button").forEach((b) => (b.disabled = false));
};

const busy = (form) => {
  form.querySelector(".form-error").hidden = true;
  form.querySelectorAll("button[type=submit]").forEach((b) => (b.disabled = true));
};

const pageError = (err) => {
  if (err.message === "Unauthorized") return;
  app.innerHTML = `<div class="alert error">${esc(err.message)}</div><a href="#/">Back to home</a>`;
};

function renderNav(route) {
  const link = (href, label) =>
    `<a href="${href}" class="${route.startsWith(href.slice(1)) && href !== "#/" ? "active" : ""}">${label}</a>`;
  nav.innerHTML = auth.token
    ? `${link("#/clients", "Clients")}${link("#/contracts", "Contracts")}${link("#/service-requests", "Service Requests")}
       <span class="user">Signed in as ${esc(auth.user)}</span>
       <button class="button small" id="logout">Log out</button>`
    : `<a href="#/login">Log in</a>`;
  document.getElementById("logout")?.addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    auth.clear();
    setFlash("success", "You have been logged out.");
    location.hash = "#/login";
  });
}

// ---------- pages ----------
function homePage() {
  app.innerHTML = `${takeFlash()}
    <section class="hero">
      <p class="eyebrow">LOGISTICS SERVICE MANAGEMENT</p>
      <h1>Manage clients, contracts and service requests.</h1>
      <p>Track every client agreement from draft to expiry, keep signed PDFs on file, and price service requests in rand using the live USD exchange rate.</p>
      <div class="actions">
        <a class="button" href="#/clients/new">Create client</a>
        <a class="button secondary" href="#/contracts/new">Create contract</a>
      </div>
    </section>
    <section class="tiles">
      <a class="tile" href="#/clients"><h2>Clients</h2><p>Manage client contacts and regions.</p></a>
      <a class="tile" href="#/contracts"><h2>Contracts</h2><p>Filter by dates and status; download signed PDFs.</p></a>
      <a class="tile" href="#/service-requests"><h2>Service requests</h2><p>Check contract workflow and calculate USD costs in ZAR.</p></a>
    </section>`;
}

function loginPage() {
  app.innerHTML = `<div class="login-wrap">${takeFlash()}
    <h1>Log in</h1>
    <p class="muted">Sign in to manage TechMove clients and contracts.</p>
    <form class="panel form" id="login">
      <div class="alert error form-error" hidden></div>
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button class="button" type="submit">Log in</button>
      <p class="hint">Demo accounts: <code>admin</code> / <code>admin123</code>, <code>user</code> / <code>user123</code>, <code>lebo</code> / <code>password123</code></p>
    </form></div>`;
  const form = document.getElementById("login");
  form.username.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    busy(form);
    try {
      const { token, username } = await api("/auth/login", {
        method: "POST",
        body: { username: form.username.value, password: form.password.value },
      });
      auth.set(token, username);
      const back = sessionStorage.getItem("tm_return");
      sessionStorage.removeItem("tm_return");
      location.hash = back && back !== "#/login" ? back : "#/";
    } catch (err) {
      formError(form, err);
    }
  });
}

async function clientsPage() {
  const list = await api("/clients");
  app.innerHTML = `${takeFlash()}
    <div class="page-heading"><div><h1>Clients</h1><p>Client contacts and regions.</p></div>
      <a class="button" href="#/clients/new">+ New client</a></div>
    <div class="panel"><table>
      <thead><tr><th>Name</th><th>Contact</th><th>Region</th><th></th></tr></thead>
      <tbody>${list
        .map(
          (c) => `<tr><td><a href="#/clients/${c.id}">${esc(c.name)}</a></td><td>${esc(c.contactDetails)}</td><td>${esc(c.region)}</td>
          <td><div class="row-actions"><a class="button small ghost" href="#/clients/${c.id}/edit">Edit</a>
          <button class="button small danger" data-delete="${c.id}" data-name="${esc(c.name)}">Delete</button></div></td></tr>`
        )
        .join("")}</tbody></table>
      ${list.length ? "" : `<p class="empty">No clients yet. Create your first client to get started.</p>`}
    </div>`;
  app.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete ${btn.dataset.name}? Their contracts and service requests are deleted too.`)) return;
      try {
        await api(`/clients/${btn.dataset.delete}`, { method: "DELETE" });
        setFlash("success", `${btn.dataset.name} was deleted.`);
        route();
      } catch (err) { pageError(err); }
    })
  );
}

async function clientFormPage(id) {
  const client = id ? await api(`/clients/${id}`) : { name: "", contactDetails: "", region: "" };
  app.innerHTML = `<h1>${id ? "Edit client" : "Create client"}</h1>
    <form class="panel form" id="client-form">
      <div class="alert error form-error" hidden></div>
      <label for="name">Name</label><input id="name" name="name" maxlength="120" required value="${esc(client.name)}" />
      <label for="contactDetails">Contact details</label><input id="contactDetails" name="contactDetails" maxlength="200" required value="${esc(client.contactDetails)}" placeholder="Email or phone number" />
      <label for="region">Region</label><input id="region" name="region" maxlength="100" required value="${esc(client.region)}" />
      <div class="form-actions"><button class="button" type="submit">${id ? "Save changes" : "Create client"}</button><a href="#/clients">Cancel</a></div>
    </form>`;
  const form = document.getElementById("client-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    busy(form);
    const body = Object.fromEntries(new FormData(form));
    try {
      const saved = await api(id ? `/clients/${id}` : "/clients", { method: id ? "PUT" : "POST", body });
      setFlash("success", `Client ${saved.name} ${id ? "updated" : "created"}.`);
      location.hash = `#/clients/${saved.id}`;
    } catch (err) { formError(form, err); }
  });
}

async function clientDetailsPage(id) {
  const c = await api(`/clients/${id}`);
  app.innerHTML = `${takeFlash()}
    <div class="page-heading"><div><h1>${esc(c.name)}</h1><p>${esc(c.region)}</p></div>
      <div class="row-actions"><a class="button ghost" href="#/clients/${c.id}/edit">Edit</a><a class="button" href="#/contracts/new?client=${c.id}">+ New contract</a></div></div>
    <div class="panel">
      <p><strong>Contact:</strong> ${esc(c.contactDetails)}</p>
      <p><strong>Region:</strong> ${esc(c.region)}</p>
      <h2>Contracts</h2>
      ${
        c.contracts.length
          ? `<ul>${c.contracts
              .map((k) => `<li>Contract #${k.id} — <span class="status ${k.status}">${k.status}</span> (${k.startDate} to ${k.endDate}) · ${esc(k.serviceLevel)}</li>`)
              .join("")}</ul>`
          : `<p class="muted">No contracts linked to this client.</p>`
      }
      <a href="#/clients">Back to clients</a>
    </div>`;
}

async function downloadAgreement(id) {
  try {
    const res = await api(`/contracts/${id}/download`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `Contract-${id}-Agreement.pdf` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    if (err.message !== "Unauthorized") alert(err.message);
  }
}

async function contractsPage(params) {
  const startDate = params.get("startDate") || "";
  const endDate = params.get("endDate") || "";
  const status = params.get("status") || "";
  const qs = new URLSearchParams(Object.entries({ startDate, endDate, status }).filter(([, v]) => v)).toString();
  const list = await api(`/contracts${qs ? "?" + qs : ""}`);

  app.innerHTML = `${takeFlash()}
    <div class="page-heading"><div><h1>Contracts</h1><p>Filter contracts by date range and status.</p></div>
      <a class="button" href="#/contracts/new">+ New contract</a></div>
    <form class="panel filters" id="filters">
      <div><label for="startDate">Start date from</label><input type="date" id="startDate" name="startDate" value="${esc(startDate)}" /></div>
      <div><label for="endDate">End date to</label><input type="date" id="endDate" name="endDate" value="${esc(endDate)}" /></div>
      <div><label for="status">Status</label><select id="status" name="status"><option value="">All statuses</option>
        ${STATUSES.map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <button class="button" type="submit">Apply filters</button>
      <a href="#/contracts">Clear</a>
    </form>
    <div class="panel"><table>
      <thead><tr><th>#</th><th>Client</th><th>Dates</th><th>Status</th><th>Service level</th><th>Agreement</th><th>Workflow</th></tr></thead>
      <tbody>${list
        .map((c) => {
          const next = NEXT_STATUSES[c.status] || [];
          return `<tr><td>${c.id}</td><td><a href="#/clients/${c.clientId}">${esc(c.clientName)}</a></td>
            <td>${c.startDate} – ${c.endDate}</td><td><span class="status ${c.status}">${c.status}</span></td>
            <td>${esc(c.serviceLevel)}</td>
            <td>${c.hasSignedAgreement ? `<button class="link-button" data-download="${c.id}">Download PDF</button>` : `<span class="muted">None</span>`}</td>
            <td>${
              next.length
                ? `<div class="row-actions"><select data-status-for="${c.id}">${next.map((s) => `<option>${s}</option>`).join("")}</select>
                   <button class="button small" data-apply="${c.id}">Move</button></div>`
                : `<span class="muted">Final state</span>`
            }</td></tr>`;
        })
        .join("")}</tbody></table>
      ${list.length ? "" : `<p class="empty">No contracts match these filters.</p>`}
    </div>`;

  document.getElementById("filters").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v)).toString();
    location.hash = `#/contracts${q ? "?" + q : ""}`;
  });
  app.querySelectorAll("[data-download]").forEach((b) => b.addEventListener("click", () => downloadAgreement(b.dataset.download)));
  app.querySelectorAll("[data-apply]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.apply;
      const target = app.querySelector(`[data-status-for="${id}"]`).value;
      b.disabled = true;
      try {
        await api(`/contracts/${id}/status`, { method: "PATCH", body: { status: target } });
        setFlash("success", `Contract #${id} moved to ${target}.`);
      } catch (err) {
        if (err.message === "Unauthorized") return;
        setFlash("error", err.message);
      }
      route();
    })
  );
}

async function contractFormPage(params) {
  const clients = await api("/clients");
  const preselect = params.get("client");
  if (!clients.length) {
    app.innerHTML = `<h1>Create contract</h1><div class="panel"><p>You need a client before you can create a contract.</p>
      <a class="button" href="#/clients/new">Create client</a></div>`;
    return;
  }
  app.innerHTML = `<h1>Create contract</h1>
    <p class="muted">New contracts start as <strong>Draft</strong>. Attach the signed agreement as a PDF.</p>
    <form class="panel form" id="contract-form">
      <div class="alert error form-error" hidden></div>
      <label for="clientId">Client</label>
      <select id="clientId" name="clientId" required><option value="">Select a client</option>
        ${clients.map((c) => `<option value="${c.id}" ${String(c.id) === preselect ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <label for="startDate">Start date</label><input type="date" id="startDate" name="startDate" required value="${today()}" />
      <label for="endDate">End date</label><input type="date" id="endDate" name="endDate" required />
      <label for="serviceLevel">Service level</label><input id="serviceLevel" name="serviceLevel" maxlength="100" required placeholder="e.g. Premium, Standard" />
      <label for="signedAgreement">Signed agreement (PDF only)</label>
      <input type="file" id="signedAgreement" name="signedAgreement" accept="application/pdf,.pdf" required />
      <div class="form-actions"><button class="button" type="submit">Create contract</button><a href="#/contracts">Cancel</a></div>
    </form>`;
  const form = document.getElementById("contract-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.endDate.value < form.startDate.value) {
      return formError(form, new Error("End date must be on or after the start date."));
    }
    const file = form.signedAgreement.files[0];
    if (file && !file.name.toLowerCase().endsWith(".pdf")) return formError(form, new Error("Only PDF files are allowed."));
    busy(form);
    try {
      const saved = await api("/contracts", { method: "POST", body: new FormData(form) });
      setFlash("success", `Contract #${saved.id} created for ${saved.clientName}.`);
      location.hash = "#/contracts";
    } catch (err) { formError(form, err); }
  });
}

async function serviceRequestsPage() {
  const list = await api("/service-requests");
  app.innerHTML = `${takeFlash()}
    <div class="page-heading"><div><h1>Service requests</h1><p>Costs are stored in ZAR, converted from USD at the live rate.</p></div>
      <a class="button" href="#/service-requests/new">+ New service request</a></div>
    <div class="panel"><table>
      <thead><tr><th>#</th><th>Client / contract</th><th>Description</th><th class="num">USD</th><th class="num">Cost (ZAR)</th><th>Created</th><th></th></tr></thead>
      <tbody>${list
        .map(
          (r) => `<tr><td>${r.id}</td><td>${esc(r.clientName)}<br><span class="muted">Contract #${r.contractId} · <span class="status ${r.contractStatus}">${r.contractStatus}</span></span></td>
          <td>${esc(r.description)}</td><td class="num">${r.originalUsdAmount ? usd(r.originalUsdAmount) : "—"}</td>
          <td class="num"><strong>${zar(r.cost)}</strong></td><td>${fmtDateTime(r.createdAt)}</td>
          <td><button class="button small danger" data-delete="${r.id}">Delete</button></td></tr>`
        )
        .join("")}</tbody></table>
      ${list.length ? "" : `<p class="empty">No service requests yet.</p>`}
    </div>`;
  app.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete service request #${btn.dataset.delete}?`)) return;
      try {
        await api(`/service-requests/${btn.dataset.delete}`, { method: "DELETE" });
        setFlash("success", `Service request #${btn.dataset.delete} was deleted.`);
        route();
      } catch (err) { pageError(err); }
    })
  );
}

async function serviceRequestFormPage() {
  const [contracts, rateResult] = await Promise.all([
    api("/contracts"),
    api("/currency/usd-zar").catch((err) => {
      if (err.message === "Unauthorized") throw err;
      return { rate: 0, message: err.message };
    }),
  ]);
  const eligible = contracts.filter((c) => c.status === "Active" || c.status === "Draft");
  const rate = Number(rateResult.rate || 0);

  app.innerHTML = `<h1>Create service request</h1>
    <p class="muted">Only <strong>Active</strong> or <strong>Draft</strong> contracts can receive service requests.</p>
    <form class="panel form" id="sr-form">
      <div class="alert error form-error" hidden></div>
      ${rate ? "" : `<div class="alert error">${esc(rateResult.message || "Could not retrieve the live exchange rate.")} Refresh or try again later.</div>`}
      <label for="contractId">Contract</label>
      <select id="contractId" name="contractId" required><option value="">Select a contract</option>
        ${eligible.map((c) => `<option value="${c.id}">${esc(c.clientName)} — #${c.id} (${c.status})</option>`).join("")}</select>
      ${eligible.length ? "" : `<p class="validation">No Active or Draft contracts are available. <a href="#/contracts/new">Create a contract</a> first.</p>`}
      <label for="description">Description</label>
      <textarea id="description" name="description" rows="4" maxlength="1000" required></textarea>
      <label for="usdAmount">Amount (USD)</label>
      <input type="number" id="usdAmount" name="usdAmount" min="0.01" step="0.01" required />
      <div class="calc">
        <span>Live rate</span><strong>${rate ? `1 USD = ${rate.toFixed(4)} ZAR` : "Unavailable"}</strong>
        <span>Estimated cost</span><strong id="zarPreview">R 0.00</strong>
      </div>
      <p class="muted">The server recalculates the rand amount with the current rate when you submit.</p>
      <div class="form-actions"><button class="button" type="submit" ${rate && eligible.length ? "" : "disabled"}>Create service request</button><a href="#/service-requests">Cancel</a></div>
    </form>`;

  const form = document.getElementById("sr-form");
  const preview = document.getElementById("zarPreview");
  form.usdAmount.addEventListener("input", () => {
    const v = Number(form.usdAmount.value || 0);
    preview.textContent = zar(v > 0 && rate > 0 ? Math.round((v * rate + Number.EPSILON) * 100) / 100 : 0);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    busy(form);
    try {
      const created = await api("/service-requests", {
        method: "POST",
        body: { contractId: Number(form.contractId.value), description: form.description.value, usdAmount: Number(form.usdAmount.value) },
      });
      setFlash("success", `Service request ${created.id} created successfully (${zar(created.cost)}).`);
      location.hash = "#/service-requests";
    } catch (err) { formError(form, err); }
  });
}

// ---------- router ----------
const routes = [
  [/^\/$/, homePage],
  [/^\/clients$/, clientsPage],
  [/^\/clients\/new$/, () => clientFormPage()],
  [/^\/clients\/(\d+)$/, (_, id) => clientDetailsPage(id)],
  [/^\/clients\/(\d+)\/edit$/, (_, id) => clientFormPage(id)],
  [/^\/contracts$/, (p) => contractsPage(p)],
  [/^\/contracts\/new$/, (p) => contractFormPage(p)],
  [/^\/service-requests$/, serviceRequestsPage],
  [/^\/service-requests\/new$/, serviceRequestFormPage],
];

async function route() {
  const hash = location.hash.slice(1) || "/";
  const [path, query = ""] = hash.split("?");
  renderNav(path);
  window.scrollTo(0, 0);

  if (path === "/login") return auth.token ? (location.hash = "#/") : loginPage();
  if (!auth.token) {
    sessionStorage.setItem("tm_return", location.hash || "#/");
    location.hash = "#/login";
    return;
  }
  for (const [pattern, handler] of routes) {
    const m = path.match(pattern);
    if (m) {
      app.innerHTML = `<p class="loading">Loading…</p>`;
      try { await handler(new URLSearchParams(query), ...m.slice(1)); } catch (err) { pageError(err); }
      return;
    }
  }
  app.innerHTML = `<h1>Page not found</h1><p><a href="#/">Back to home</a></p>`;
}

window.addEventListener("hashchange", route);
route();
