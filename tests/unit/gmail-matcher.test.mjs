import test from "node:test";
import assert from "node:assert/strict";
import { matchApplicationToEmail, isMessageProcessed } from "../../supabase/functions/gmail-status-sync/matcher.ts";

const SAMPLE_APPLICATIONS = [
  {
    id: "402fe19e-9dd5-4627-b518-72cffbce1832",
    company: "Barclays",
    job_title: "Software Engineer II - Payments",
    requisition_id: "JR-0000122265",
    confirmation_email_ref: "1a178ba455705921",
    hiring_stage: "Rejected",
  },
  {
    id: "3292d481-b2b8-4dec-9251-beb21bf580cc",
    company: "IBM",
    job_title: "Full Stack Engineer - Cloud",
    requisition_id: "134985",
    confirmation_email_ref: "1a17e883bff883bf",
    hiring_stage: "Assessment Requested",
  },
  {
    id: "27328b9f-e269-44b8-bcac-b6b44d607ad2",
    company: "Affirm",
    job_title: "Software Engineer II, Fullstack (Ads Platform)",
    requisition_id: null,
    confirmation_email_ref: null,
    hiring_stage: null,
  },
  {
    id: "a183b9cf-1122-3344-5566-778899aabbcc",
    company: "Affirm",
    job_title: "Senior Backend Engineer, Checkout",
    requisition_id: null,
    confirmation_email_ref: null,
    hiring_stage: null,
  },
  {
    id: "4fda713f-b337-4330-a6ce-4d15c47aa1d1",
    company: "Teleport",
    job_title: "Senior Full Stack Engineer",
    requisition_id: null,
    confirmation_email_ref: "1a17e902a0b8825e",
    hiring_stage: "Rejected",
  },
];

test("Gmail Matcher: Requisition ID Matching", async (t) => {
  await t.test("matches Barclays by requisition ID JR-0000122265", () => {
    const email = {
      id: "1a178ba455705921",
      threadId: "1a178ba455705921",
      from: "jobs@barclays.com",
      subject: "Update regarding JR-0000122265",
      bodyText: "Your application for requisition JR-0000122265 has an update.",
    };

    const res = matchApplicationToEmail(email, SAMPLE_APPLICATIONS);
    assert.equal(res.matched, true);
    assert.equal(res.ambiguous, false);
    assert.equal(res.matchedApplication?.id, "402fe19e-9dd5-4627-b518-72cffbce1832");
    assert.ok(res.matchBasis?.includes("Requisition ID"));
  });

  await t.test("matches IBM by requisition number in subject", () => {
    const email = {
      id: "1a17e94dd1ebd76d",
      threadId: "1a17e883bff883bf",
      from: "talent@ibm.com",
      subject: "Coding Assessment - 134985",
      bodyText: "Please complete coding assessment for job 134985.",
    };

    const res = matchApplicationToEmail(email, SAMPLE_APPLICATIONS);
    assert.equal(res.matched, true);
    assert.equal(res.matchedApplication?.id, "3292d481-b2b8-4dec-9251-beb21bf580cc");
  });
});

test("Gmail Matcher: Confirmation Email Ref / Thread ID Matching", async (t) => {
  await t.test("matches Teleport by existing confirmation thread ref", () => {
    const email = {
      id: "1a17e902a0b8825e",
      threadId: "1a17e902a0b8825e",
      from: "ashby@teleport.com",
      subject: "Teleport Application Update",
      bodyText: "Thank you for applying to Teleport.",
    };

    const res = matchApplicationToEmail(email, SAMPLE_APPLICATIONS);
    assert.equal(res.matched, true);
    assert.equal(res.matchedApplication?.id, "4fda713f-b337-4330-a6ce-4d15c47aa1d1");
  });
});

test("Gmail Matcher: Single Company Application Hardening", async (t) => {
  await t.test("does NOT auto-match single application when email lacks role or requisition details", () => {
    // Only 1 application for "Datadog"
    const datadogApps = [
      {
        id: "datadog-uuid-1234",
        company: "Datadog",
        job_title: "Senior Reliability Engineer",
        requisition_id: "DD-9988",
        confirmation_email_ref: null,
        hiring_stage: null,
      },
    ];

    const vagueEmail = {
      id: "vague_msg_1",
      threadId: "vague_thread_1",
      from: "newsletter@datadog.com",
      subject: "Updates from Datadog",
      bodyText: "Thanks for checking in with Datadog. Check out our open roles.",
    };

    const res = matchApplicationToEmail(vagueEmail, datadogApps);
    assert.equal(res.matched, false);
    assert.equal(res.ambiguous, true);
    assert.equal(res.reasonCode, "role_less_specific_than_application");
  });

  await t.test("matches single application when job title is explicitly corroborated", () => {
    const datadogApps = [
      {
        id: "datadog-uuid-1234",
        company: "Datadog",
        job_title: "Senior Reliability Engineer",
        requisition_id: "DD-9988",
        confirmation_email_ref: null,
        hiring_stage: null,
      },
    ];

    const specificEmail = {
      id: "specific_msg_1",
      threadId: "specific_thread_1",
      from: "recruiter@datadog.com",
      subject: "Your application for Senior Reliability Engineer at Datadog",
      bodyText: "Regarding your candidacy for Senior Reliability Engineer.",
    };

    const res = matchApplicationToEmail(specificEmail, datadogApps);
    assert.equal(res.matched, true);
    assert.equal(res.ambiguous, false);
    assert.equal(res.matchedApplication?.id, "datadog-uuid-1234");
  });
});

test("Gmail Matcher: Unverified Third-Party Sender", async (t) => {
  await t.test("flags Gem sender without employer domain match for review", () => {
    const email = {
      id: "1a182c7ee8a9d91a",
      threadId: "1a182c7ee8a9d91a",
      from: "recruiter@gem.com",
      subject: "Update from Affirm team",
      bodyText: "Regarding your candidacy at Affirm.",
    };

    const res = matchApplicationToEmail(email, SAMPLE_APPLICATIONS);
    assert.equal(res.matched, false);
    assert.equal(res.ambiguous, true);
    assert.equal(res.reasonCode, "sender_employer_mapping_unverified");
  });
});

test("Gmail Matcher: Deduplication Logic", async (t) => {
  await t.test("recognizes already processed message IDs", () => {
    const processedSet = new Set(["1a178ba455705921", "1a17e94dd1ebd76d"]);
    assert.equal(isMessageProcessed("1a178ba455705921", processedSet), true);
    assert.equal(isMessageProcessed("1a19999999999999", processedSet), false);
  });
});

