-- Same sample data the .NET API seeds on first start: one client with an active contract.
WITH new_client AS (
  INSERT INTO "clients" ("name", "contact_details", "region")
  VALUES ('Lebo', 'lebo@example.com', 'South Africa')
  RETURNING "id"
)
INSERT INTO "contracts" ("client_id", "start_date", "end_date", "status", "service_level")
SELECT "id", CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 year')::date, 'Active', 'Premium' FROM new_client;
