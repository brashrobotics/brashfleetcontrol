import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterConformanceReport } from "./adapter-conformance.js";

export interface AdapterCertificate {
  certificateId: string;
  certificationVersion: "1.0";
  adapterId: string;
  adapterVersion: string;
  protocol: string;
  approvedBy: string;
  issuedAt: string;
  expiresAt: string;
  report: AdapterConformanceReport;
  signature: string;
}

export function issueAdapterCertificate(report: AdapterConformanceReport, approvedBy: string, signingKey: string, options: { issuedAt?: Date; validityDays?: number } = {}): AdapterCertificate {
  if (!report.compliant || report.checks.some((check) => check.status !== "PASS")) throw new Error("A certificate can only be issued for a fully compliant adapter report.");
  if (!approvedBy.trim()) throw new Error("Certificate approver is required.");
  assertSigningKey(signingKey);
  const issuedAt = options.issuedAt ?? new Date();
  const validityDays = options.validityDays ?? 90;
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) throw new Error("Certificate validityDays must be between 1 and 365.");
  const unsigned = {
    certificationVersion: "1.0" as const, adapterId: report.adapterId, adapterVersion: report.adapterVersion,
    protocol: report.protocol, approvedBy, issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + validityDays * 86_400_000).toISOString(), report: structuredClone(report),
  };
  const signature = sign(unsigned, signingKey);
  return { certificateId: `ADAPTER-CERT-${signature.slice(0, 24)}`, ...unsigned, signature };
}

export function verifyAdapterCertificate(certificate: AdapterCertificate, signingKey: string, now = new Date()): { valid: boolean; reason: string | null } {
  try { assertSigningKey(signingKey); } catch (error) { return { valid: false, reason: error instanceof Error ? error.message : String(error) }; }
  if (!certificate.report.compliant) return { valid: false, reason: "Embedded conformance report is not compliant." };
  if (new Date(certificate.expiresAt).getTime() <= now.getTime()) return { valid: false, reason: "Certificate has expired." };
  const { certificateId: _certificateId, signature, ...unsigned } = certificate;
  const expected = sign(unsigned, signingKey);
  const left = Buffer.from(signature, "hex");
  const right = Buffer.from(expected, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { valid: false, reason: "Certificate signature is invalid." };
  return { valid: true, reason: null };
}

function sign(value: unknown, key: string): string {
  return createHmac("sha256", key).update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function assertSigningKey(key: string): void {
  if (Buffer.byteLength(key, "utf8") < 32) throw new Error("Adapter certificate signing key must contain at least 32 bytes.");
}
