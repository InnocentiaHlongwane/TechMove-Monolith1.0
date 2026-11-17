// Business rules ported from TechMove.Core (ContractWorkflow, UploadValidator, CurrencyService).

export const STATUSES = ["Draft", "Active", "Expired", "OnHold"] as const;
export type ContractStatus = (typeof STATUSES)[number];

export const parseStatus = (value: string): ContractStatus | null =>
  STATUSES.find((s) => s.toLowerCase() === value.trim().toLowerCase()) ?? null;

/** Service requests can only be raised against Active or Draft contracts. */
export const canCreateServiceRequest = (status: ContractStatus) => status === "Active" || status === "Draft";

/** Allowed workflow: Draft → Active, Active ⇄ OnHold, Active → Expired. */
export const canTransitionTo = (current: ContractStatus, target: ContractStatus) =>
  (current === "Draft" && target === "Active") ||
  (current === "Active" && target === "OnHold") ||
  (current === "OnHold" && target === "Active") ||
  (current === "Active" && target === "Expired");

export const isValidPdf = (fileName: string, contentType: string) =>
  Boolean(fileName?.trim()) && fileName.toLowerCase().endsWith(".pdf") && contentType === "application/pdf";

const RATE_URL = "https://api.exchangerate-api.com/v4/latest/USD";
const RATE_TTL_MS = 30 * 60 * 1000;
let cachedRate: { value: number; at: number } | null = null;

/** Live USD → ZAR rate, cached in memory for 30 minutes (cache only, never storage). */
export async function getUsdToZarRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.at < RATE_TTL_MS) return cachedRate.value;
  const res = await fetch(RATE_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Exchange rate API returned ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, unknown> };
  const rate = Number(data?.rates?.ZAR);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Could not parse exchange rate from API response.");
  cachedRate = { value: rate, at: Date.now() };
  return rate;
}
