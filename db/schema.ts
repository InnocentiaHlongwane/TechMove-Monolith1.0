import { pgTable, pgEnum, serial, text, integer, date, numeric, timestamp, varchar } from "drizzle-orm/pg-core";

export const contractStatus = pgEnum("contract_status", ["Draft", "Active", "Expired", "OnHold"]);

export const clients = pgTable("clients", {
  id: serial().primaryKey(),
  name: varchar({ length: 120 }).notNull(),
  contactDetails: varchar("contact_details", { length: 200 }).notNull(),
  region: varchar({ length: 100 }).notNull(),
});

export const contracts = pgTable("contracts", {
  id: serial().primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: contractStatus().notNull().default("Draft"),
  serviceLevel: varchar("service_level", { length: 100 }).notNull(),
  // Key of the signed PDF agreement in the "agreements" blob store (empty when none was uploaded).
  signedAgreementKey: text("signed_agreement_key").notNull().default(""),
});

export const serviceRequests = pgTable("service_requests", {
  id: serial().primaryKey(),
  contractId: integer("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  description: varchar({ length: 1000 }).notNull(),
  cost: numeric({ precision: 18, scale: 2 }).notNull(),
  currency: varchar({ length: 3 }).notNull().default("ZAR"),
  originalUsdAmount: numeric("original_usd_amount", { precision: 18, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  token: text().primaryKey(),
  username: text().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
