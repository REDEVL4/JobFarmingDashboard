import type { StatusDefinition, NormalizedStatus } from "@/types/dashboard";

/**
 * Canonical Application States derived from career-ops/templates/states.yml
 * Single source of truth for status normalization.
 */
export const CANONICAL_STATES: StatusDefinition[] = [
  {
    id: "evaluated",
    label: "Evaluated",
    group: "pending",
    aliases: ["evaluada", "condicional", "hold", "evaluar", "verificar", "değerlendirildi", "degerlendirildi"],
    description: "Offer evaluated with report, pending decision",
  },
  {
    id: "applied",
    label: "Applied",
    group: "applied",
    aliases: ["aplicado", "enviada", "aplicada", "sent", "başvuruldu", "basvuruldu", "application_confirmed", "submitted"],
    description: "Application submitted",
  },
  {
    id: "under_review",
    label: "Under Review",
    group: "under_review",
    aliases: ["under review", "in review", "reviewing", "screening"],
    description: "Application actively under review by company",
  },
  {
    id: "responded",
    label: "Responded",
    group: "under_review",
    aliases: ["respondido", "yanıt verildi", "yanıt_verildi", "yanit verildi", "yanit_verildi", "recruiter_screen", "acknowledgement"],
    description: "Company has responded (not yet interview)",
  },
  {
    id: "assessment",
    label: "Assessment",
    group: "assessment",
    aliases: ["take home", "online assessment", "oa", "coding test", "hacker rank", "codesignal"],
    description: "Skills assessment or coding challenge assigned",
  },
  {
    id: "interview",
    label: "Interview",
    group: "interviewing",
    aliases: ["entrevista", "mülakat", "mulakat", "interviewing", "phone_screen", "technical_interview", "final_round", "onsite"],
    description: "Active interview process",
  },
  {
    id: "offer",
    label: "Offer",
    group: "offer",
    aliases: ["oferta", "teklif", "offer extended", "offer received"],
    description: "Offer received",
    isTerminal: true,
  },
  {
    id: "hired",
    label: "Hired",
    group: "offer",
    aliases: ["contratado", "contratada", "hired", "accepted", "accept", "kabul edildi", "işe alındı", "ise alindi"],
    description: "Offer accepted, job landed!",
    isTerminal: true,
  },
  {
    id: "rejected",
    label: "Rejected",
    group: "rejected",
    aliases: ["rechazado", "rechazada", "reddedildi", "rejected_by_company", "declined", "unsuccessful"],
    description: "Rejected by company",
    isTerminal: true,
  },
  {
    id: "discarded",
    label: "Discarded",
    group: "withdrawn",
    aliases: ["descartado", "descartada", "cerrada", "cancelada", "iptal edildi", "withdrawn", "closed"],
    description: "Discarded by candidate or offer closed",
    isTerminal: true,
  },
  {
    id: "skip",
    label: "SKIP",
    group: "withdrawn",
    aliases: ["no_aplicar", "no aplicar", "skip", "monitor", "geo blocker", "geo_blocker", "uygun değil", "uygun degil"],
    description: "Doesn't fit, don't apply",
    isTerminal: true,
  },
];
