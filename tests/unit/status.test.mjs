import test from "node:test";
import assert from "node:assert/strict";

// Mirror canonical states logic for standalone Node test runner
const CANONICAL_STATES = [
  { id: "evaluated", group: "pending", aliases: ["evaluada", "condicional", "hold"] },
  { id: "applied", group: "applied", aliases: ["aplicado", "enviada", "sent", "başvuruldu", "submitted"] },
  { id: "under_review", group: "under_review", aliases: ["under review", "in review", "screening"] },
  { id: "responded", group: "under_review", aliases: ["respondido", "yanıt verildi"] },
  { id: "assessment", group: "assessment", aliases: ["take home", "online assessment", "oa", "coding test"] },
  { id: "interview", group: "interviewing", aliases: ["entrevista", "mülakat", "phone_screen", "technical_interview"] },
  { id: "offer", group: "offer", aliases: ["oferta", "teklif"] },
  { id: "hired", group: "offer", aliases: ["contratado", "hired", "accepted"] },
  { id: "rejected", group: "rejected", aliases: ["rechazado", "rechazada", "reddedildi", "rejected_by_company"] },
  { id: "discarded", group: "withdrawn", aliases: ["descartado", "cerrada", "cancelada"] },
  { id: "skip", group: "withdrawn", aliases: ["no_aplicar", "skip", "monitor"] },
];

function normalizeStatus(raw) {
  if (!raw || !raw.trim()) return { normalized: "unmapped", isUnmapped: true };
  const cleaned = raw.replace(/\*\*/g, "").replace(/\([^)]*\)/g, "").replace(/[❌✅]/g, "").trim().toLowerCase();

  for (const s of CANONICAL_STATES) {
    if (s.id === cleaned || s.aliases.some((a) => a === cleaned)) {
      return { normalized: s.group, isUnmapped: false };
    }
  }

  if (cleaned.includes("interview")) return { normalized: "interviewing", isUnmapped: false };
  if (cleaned.includes("reject")) return { normalized: "rejected", isUnmapped: false };
  if (cleaned.includes("offer")) return { normalized: "offer", isUnmapped: false };
  if (cleaned.includes("applied")) return { normalized: "applied", isUnmapped: false };
  if (cleaned.includes("skip")) return { normalized: "withdrawn", isUnmapped: false };

  return { normalized: "unmapped", isUnmapped: true };
}

test("Status Normalization: canonical states map to correct dashboard groups", () => {
  assert.equal(normalizeStatus("applied").normalized, "applied");
  assert.equal(normalizeStatus("Applied").normalized, "applied");
  assert.equal(normalizeStatus("Interview").normalized, "interviewing");
  assert.equal(normalizeStatus("rejected").normalized, "rejected");
  assert.equal(normalizeStatus("offer").normalized, "offer");
  assert.equal(normalizeStatus("evaluated").normalized, "pending");
  assert.equal(normalizeStatus("skip").normalized, "withdrawn");
});

test("Status Normalization: multilingual aliases map correctly", () => {
  assert.equal(normalizeStatus("enviada").normalized, "applied");
  assert.equal(normalizeStatus("başvuruldu").normalized, "applied");
  assert.equal(normalizeStatus("entrevista").normalized, "interviewing");
  assert.equal(normalizeStatus("mülakat").normalized, "interviewing");
  assert.equal(normalizeStatus("rechazado").normalized, "rejected");
  assert.equal(normalizeStatus("reddedildi").normalized, "rejected");
});

test("Status Normalization: preserves unmapped statuses explicitly", () => {
  const result = normalizeStatus("custom_unseen_state");
  assert.equal(result.normalized, "unmapped");
  assert.equal(result.isUnmapped, true);
});

test("Status Normalization: handles markdown and emojis gracefully", () => {
  assert.equal(normalizeStatus("**Applied** (2026-10-30)").normalized, "applied");
  assert.equal(normalizeStatus("Interview ✅").normalized, "interviewing");
  assert.equal(normalizeStatus("SKIP ❌").normalized, "withdrawn");
});

