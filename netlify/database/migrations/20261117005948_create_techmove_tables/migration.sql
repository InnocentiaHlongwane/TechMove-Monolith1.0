CREATE TYPE "contract_status" AS ENUM('Draft', 'Active', 'Expired', 'OnHold');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY,
	"name" varchar(120) NOT NULL,
	"contact_details" varchar(200) NOT NULL,
	"region" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY,
	"client_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "contract_status" DEFAULT 'Draft'::"contract_status" NOT NULL,
	"service_level" varchar(100) NOT NULL,
	"signed_agreement_key" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" serial PRIMARY KEY,
	"contract_id" integer NOT NULL,
	"description" varchar(1000) NOT NULL,
	"cost" numeric(18,2) NOT NULL,
	"currency" varchar(3) DEFAULT 'ZAR' NOT NULL,
	"original_usd_amount" numeric(18,2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY,
	"username" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_contract_id_contracts_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE;