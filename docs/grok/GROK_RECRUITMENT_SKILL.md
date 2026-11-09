# Grok Skill: Job Farming — Recruitment Status Intelligence

## Overview
This skill guides Grok in reading pending recruitment emails from the Job Farming processing queue, matching them against candidate job applications, and submitting evidence-backed classification proposals into the owner review queue.

---

## Operating Invariants & Safety Boundaries
1. **Read-Only Application Statuses**: You do not modify `jobbot.job_applications.application_status`. All classifications are submitted as proposals to `jobbot.recruitment_review_items` for the owner to review and confirm.
2. **Zero Outbound Communication**: You never send emails, replies, or LinkedIn messages.
3. **Evidence-Backed**: Every proposal must include concrete textual evidence extracted from the subject and sender details.
4. **Idempotency**: Submissions must use consistent parameters to prevent duplicate proposals.
5. **Fail-Safe Ambiguity Handling**: If multiple applications match a company or the sender is uncertain, mark the classification as `other_uncertain` or document the ambiguity in `ambiguity_notes`.

---

## Tool Definitions & Workflow

### 1. Check Operating Status
First, call `runtime_status` to ensure the owner session is authenticated and operational:
```json
{
  "name": "runtime_status",
  "arguments": {}
}
```

### 2. Fetch Pending Queue Batch
Retrieve up to 25 pending recruitment emails:
```json
{
  "name": "list_pending_recruitment_emails",
  "arguments": {
    "limit": 10
  }
}
```

### 3. Match Candidate Applications
For each email, extract the company name and/or job requisition title from `subject_clean` and `sender_clean`. Search for existing applications:
```json
{
  "name": "find_candidate_applications",
  "arguments": {
    "query": "Company Name",
    "limit": 5
  }
}
```

### 4. Classification Categories
Select the most accurate category:
- `application_confirmation`: "Thank you for applying to...", "We have received your application"
- `interview_invitation`: "Invitation to interview", "Availability for a chat", "Recruiter screening"
- `assessment`: "Coding challenge", "HackerRank assessment", "Take-home project"
- `recruiter_follow_up`: "Update regarding your application", "Question regarding your resume"
- `rejection`: "Thank you for your interest, however we have decided to pursue other candidates"
- `offer`: "Offer of employment", "Offer letter"
- `other_uncertain`: Ambiguous company name, general job newsletter, or automated bounce

### 5. Submit Classification Proposal
Submit the proposal into the review queue for owner confirmation:
```json
{
  "name": "submit_classification_proposal",
  "arguments": {
    "queue_id": "<uuid-from-queue>",
    "classification": "rejection",
    "confidence": 0.95,
    "application_id": "<uuid-of-matched-application>",
    "evidence_summary": "Subject clean: 'Update on your application with Stripe'. Sender: 'recruiting@stripe.com'. Body confirms candidate was not selected.",
    "proposed_stage": "Rejected",
    "ambiguity_notes": null,
    "idempotency_key": "<uuid>"
  }
}
```

---

## Bounded Execution & Error Handling
- Process messages in bounded batches of 10-25.
- Never loop indefinitely.
- Report all submitted proposals, ambiguous items, and unhandled emails in your response summary.
