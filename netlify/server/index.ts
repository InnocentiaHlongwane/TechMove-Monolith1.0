import { Hono, type Context, type Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getStore } from "@netlify/blobs";
import { and, asc, desc, eq, gte, lte, gt, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../../db/index.ts";
import { clients, contracts, serviceRequests, sessions } from "../../db/schema.ts";
import {
  STATUSES,
  type ContractStatus,
  canCreateServiceRequest,
  canTransitionTo,
  isValidPdf,
  parseStatus,
  getUsdToZarRate,
} from "../../lib/domain.ts";

type Env = { Variables: { username: string } };
const app = new Hono<Env>().basePath("/api");

const agreements = () => getStore({ name: "agreements", consistency: "strong" });

// Demo accounts, same as the original TechMove.API AuthController.
const DEMO_USERS: Record<string, string> = { admin: "admin123", user: "user123", lebo: "password123" };
const SESSION_HOURS = 8;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const bad = (message: string, status: 400 | 401 | 404 = 400) => {
  throw new HTTPException(status, { res: Response.json({ message }, { status }) });
};

const toInt = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const str = (v: unknown, field: string, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) bad(`${field} is required.`);
  if (s.length > max) bad(`${field} must be ${max} characters or fewer.`);
  return s;
};

const isoDate = (v: unknown, field: string) => {
  const s = typeof v === "string" ? v : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) bad(`${field} must be a valid date.`);
  return s;
};

const json = async (c: Context) => {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return bad("Request body must be JSON.");
  }
};

// ---------- Auth ----------

app.post("/auth/login", async (c) => {
  const { username, password } = await json(c);
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
    bad("Username and password are required");
  }
  const name = (username as string).trim();
  if (DEMO_USERS[name] !== password) bad("Invalid username or password", 401);

  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await db.insert(sessions).values({ token, username: name, expiresAt });
  return c.json({ token, username: name, expiresAt, message: "Login successful" });
});

const requireAuth = async (c: Context<Env>, next: Next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) bad("Authentication required", 401);
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));
  if (!session) bad("Your session has expired. Please log in again.", 401);
  c.set("username", session!.username);
  await next();
};

app.use("/clients/*", requireAuth);
app.use("/clients", requireAuth);
app.use("/contracts/*", requireAuth);
app.use("/contracts", requireAuth);
app.use("/service-requests/*", requireAuth);
app.use("/service-requests", requireAuth);
app.use("/currency/*", requireAuth);
app.use("/auth/logout", requireAuth);
app.use("/auth/me", requireAuth);

app.get("/auth/me", (c) => c.json({ username: c.get("username") }));

app.post("/auth/logout", async (c) => {
  const token = (c.req.header("authorization") ?? "").slice(7);
  await db.delete(sessions).where(eq(sessions.token, token));
  return c.body(null, 204);
});

// ---------- Clients ----------

const clientBody = async (c: Context) => {
  const b = await json(c);
  return {
    name: str(b.name, "Name", 120),
    contactDetails: str(b.contactDetails, "Contact details", 200),
    region: str(b.region, "Region", 100),
  };
};

app.get("/clients", async (c) => c.json(await db.select().from(clients).orderBy(asc(clients.name))));

app.get("/clients/:id", async (c) => {
  const id = toInt(c.req.param("id"));
  const [client] = id ? await db.select().from(clients).where(eq(clients.id, id)) : [];
  if (!client) bad("Client not found.", 404);
  const clientContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.clientId, client.id))
    .orderBy(desc(contracts.startDate));
  return c.json({ ...client, contracts: clientContracts.map(contractDto(client.name)) });
});

app.post("/clients", async (c) => {
  const [created] = await db.insert(clients).values(await clientBody(c)).returning();
  return c.json(created, 201);
});

app.put("/clients/:id", async (c) => {
  const id = toInt(c.req.param("id"));
  const body = await clientBody(c);
  const [updated] = id ? await db.update(clients).set(body).where(eq(clients.id, id)).returning() : [];
  if (!updated) bad("Client not found.", 404);
  return c.json(updated);
});

app.delete("/clients/:id", async (c) => {
  const id = toInt(c.req.param("id"));
  if (!id) bad("Client not found.", 404);
  const owned = await db.select({ key: contracts.signedAgreementKey }).from(contracts).where(eq(contracts.clientId, id!));
  const [deleted] = await db.delete(clients).where(eq(clients.id, id!)).returning();
  if (!deleted) bad("Client not found.", 404);
  await Promise.all(owned.filter((o) => o.key).map((o) => agreements().delete(o.key)));
  return c.body(null, 204);
});

// ---------- Contracts ----------

type ContractRow = typeof contracts.$inferSelect;
const contractDto = (clientName: string | null) => (row: ContractRow) => {
  const { signedAgreementKey, ...rest } = row;
  return { ...rest, clientName, hasSignedAgreement: Boolean(signedAgreementKey) };
};

const contractSelect = { contract: contracts, clientName: clients.name };

app.get("/contracts", async (c) => {
  const { startDate, endDate, status } = c.req.query();
  const filters = [];
  if (startDate) filters.push(gte(contracts.startDate, isoDate(startDate, "Start date")));
  if (endDate) filters.push(lte(contracts.endDate, isoDate(endDate, "End date")));
  const parsed = status ? parseStatus(status) : null;
  if (parsed) filters.push(eq(contracts.status, parsed));

  const rows = await db
    .select(contractSelect)
    .from(contracts)
    .innerJoin(clients, eq(contracts.clientId, clients.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(contracts.startDate), desc(contracts.id));
  return c.json(rows.map((r) => contractDto(r.clientName)(r.contract)));
});

const findContract = async (idParam: string) => {
  const id = toInt(idParam);
  const [row] = id
    ? await db.select(contractSelect).from(contracts).innerJoin(clients, eq(contracts.clientId, clients.id)).where(eq(contracts.id, id))
    : [];
  if (!row) bad("Contract not found.", 404);
  return row!;
};

app.get("/contracts/:id", async (c) => {
  const row = await findContract(c.req.param("id"));
  return c.json(contractDto(row.clientName)(row.contract));
});

app.post("/contracts", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return bad("Send the contract as multipart form data.");
  }
  const file = form.get("signedAgreement");
  if (!(file instanceof File) || file.size === 0) bad("A signed PDF agreement is required.");
  const pdf = file as File;
  if (!isValidPdf(pdf.name, pdf.type)) bad("Only PDF files are allowed.");
  if (pdf.size > MAX_PDF_BYTES) bad("The PDF must be 10 MB or smaller.");

  const clientId = toInt(form.get("clientId"));
  if (!clientId) bad("Select a client.");
  const startDate = isoDate(form.get("startDate"), "Start date");
  const endDate = isoDate(form.get("endDate"), "End date");
  if (endDate < startDate) bad("End date must be on or after the start date.");
  const serviceLevel = str(form.get("serviceLevel"), "Service level", 100);

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId!));
  if (!client) bad("Invalid client ID.");

  const bytes = await pdf.arrayBuffer();
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  if (header !== "%PDF-") bad("The uploaded file is not a valid PDF.");

  const key = `contracts/${randomBytes(16).toString("hex")}.pdf`;
  await agreements().set(key, bytes, { metadata: { originalName: pdf.name } });

  const [created] = await db
    .insert(contracts)
    .values({ clientId: clientId!, startDate, endDate, serviceLevel, status: "Draft", signedAgreementKey: key })
    .returning();
  return c.json(contractDto(client.name)(created), 201);
});

app.patch("/contracts/:id/status", async (c) => {
  const row = await findContract(c.req.param("id"));
  const { status } = await json(c);
  const next = parseStatus(String(status ?? ""));
  if (!next) bad("Invalid status value.");
  const current = row.contract.status as ContractStatus;
  if (!canTransitionTo(current, next!)) bad(`Cannot transition from ${current} to ${next}.`);
  const [updated] = await db.update(contracts).set({ status: next! }).where(eq(contracts.id, row.contract.id)).returning();
  return c.json(contractDto(row.clientName)(updated));
});

app.get("/contracts/:id/download", async (c) => {
  const row = await findContract(c.req.param("id"));
  if (!row.contract.signedAgreementKey) bad("No signed agreement was uploaded for this contract.", 404);
  const file = await agreements().get(row.contract.signedAgreementKey, { type: "arrayBuffer" });
  if (!file) bad("Agreement file not found.", 404);
  return new Response(file, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Contract-${row.contract.id}-Agreement.pdf"`,
    },
  });
});

// ---------- Service requests ----------

const requestSelect = {
  id: serviceRequests.id,
  contractId: serviceRequests.contractId,
  description: serviceRequests.description,
  cost: serviceRequests.cost,
  currency: serviceRequests.currency,
  originalUsdAmount: serviceRequests.originalUsdAmount,
  createdAt: serviceRequests.createdAt,
  contractStatus: contracts.status,
  clientName: clients.name,
};

const requestQuery = () =>
  db
    .select(requestSelect)
    .from(serviceRequests)
    .innerJoin(contracts, eq(serviceRequests.contractId, contracts.id))
    .innerJoin(clients, eq(contracts.clientId, clients.id));

app.get("/service-requests", async (c) => c.json(await requestQuery().orderBy(desc(serviceRequests.createdAt))));

app.get("/service-requests/contract/:contractId", async (c) => {
  const id = toInt(c.req.param("contractId"));
  if (!id) return c.json([]);
  return c.json(await requestQuery().where(eq(serviceRequests.contractId, id)).orderBy(desc(serviceRequests.createdAt)));
});

app.get("/service-requests/:id", async (c) => {
  const id = toInt(c.req.param("id"));
  const [row] = id ? await requestQuery().where(eq(serviceRequests.id, id)) : [];
  if (!row) bad("Service request not found.", 404);
  return c.json(row);
});

app.post("/service-requests", async (c) => {
  const b = await json(c);
  const contractId = toInt(b.contractId);
  if (!contractId) bad("Select a valid contract.");
  const description = str(b.description, "Description", 1000);
  const usdAmount = Number(b.usdAmount);
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) bad("Enter a USD amount greater than zero.");
  if (usdAmount > 100_000_000) bad("The USD amount is too large.");

  const row = await findContract(String(contractId));
  const status = row.contract.status as ContractStatus;
  if (!canCreateServiceRequest(status)) {
    bad(`A service request cannot be created because this contract is ${status}. Choose an Active or Draft contract.`);
  }

  let rate: number;
  try {
    rate = await getUsdToZarRate();
  } catch {
    return bad("Could not verify the current exchange rate. Please try again.");
  }
  // The server recalculates the amount; never trust a client-posted calculated cost.
  const zar = Math.round((usdAmount * rate + Number.EPSILON) * 100) / 100;

  const [created] = await db
    .insert(serviceRequests)
    .values({
      contractId: contractId!,
      description,
      cost: zar.toFixed(2),
      currency: "ZAR",
      originalUsdAmount: usdAmount.toFixed(2),
    })
    .returning();
  return c.json({ ...created, rate }, 201);
});

app.put("/service-requests/:id", async (c) => {
  const id = toInt(c.req.param("id"));
  const b = await json(c);
  const description = str(b.description, "Description", 1000);
  const cost = Number(b.cost);
  if (!Number.isFinite(cost) || cost < 0.01 || cost > 100_000_000) bad("Cost must be between 0.01 and 100,000,000.");
  const [updated] = id
    ? await db.update(serviceRequests).set({ description, cost: cost.toFixed(2) }).where(eq(serviceRequests.id, id)).returning()
    : [];
  if (!updated) bad("Service request not found.", 404);
  return c.json(updated);
});

app.delete("/service-requests/:id", async (c) => {
  const id = toInt(c.req.param("id"));
  const [deleted] = id ? await db.delete(serviceRequests).where(eq(serviceRequests.id, id)).returning() : [];
  if (!deleted) bad("Service request not found.", 404);
  return c.body(null, 204);
});

// ---------- Currency ----------

app.get("/currency/usd-zar", async (c) => {
  try {
    return c.json({ rate: await getUsdToZarRate() });
  } catch {
    return c.json({ message: "Could not retrieve the live exchange rate. Refresh or try again later." }, 503);
  }
});

app.get("/meta", (c) => c.json({ statuses: STATUSES }));

app.notFound((c) => c.json({ message: "Not found" }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ message: "Something went wrong. Please try again." }, 500);
});

export const config = { path: "/api/*" };
export default app;
