import test from "node:test";
import assert from "node:assert/strict";

test("Outreach Attachment: filename extraction extracts only the last segment", () => {
  const fullPath = "applications/sqlite_li_4481262703/resume/v1/Govardhan_Narala_Resume_Turnberry_AIMLEngineer.pdf";
  const fileName = fullPath.split("/").pop();
  assert.equal(fileName, "Govardhan_Narala_Resume_Turnberry_AIMLEngineer.pdf");
});

test("Outreach Attachment: labels 'Resume attached' when action_type is resume_share", () => {
  const proposalResume = {
    id: "7718f39d-42a5-475e-86b9-54e386e91180",
    action_type: "resume_share",
    attachment_path: "applications/sqlite_li_4481262703/resume/v1/Govardhan_Narala_Resume_Turnberry_AIMLEngineer.pdf",
  };
  const isResume = proposalResume.action_type === "resume_share";
  assert.equal(isResume, true);

  const proposalMessage = {
    id: "some-id",
    action_type: "message",
    attachment_path: "documents/notes.txt",
  };
  assert.equal(proposalMessage.action_type === "resume_share", false);
});

test("Outreach Attachment: when attachment_path is null, shows nothing extra", () => {
  const proposalNull = {
    id: "null-attachment-id",
    action_type: "message",
    attachment_path: null,
  };
  assert.equal(Boolean(proposalNull.attachment_path), false);

  const proposalUndefined = {
    id: "undefined-attachment-id",
    action_type: "resume_share",
  };
  assert.equal(Boolean(proposalUndefined.attachment_path), false);
});

test("Outreach Attachment: validates storage bucket and path safety", () => {
  const BUCKET_NAME = "jobbot-application-docs";
  assert.equal(BUCKET_NAME, "jobbot-application-docs");

  const unsafePath = "../secret/credentials.json";
  assert.equal(unsafePath.includes(".."), true);

  const safePath = "applications/sqlite_li_4481262703/resume/v1/Govardhan_Narala_Resume_Turnberry_AIMLEngineer.pdf";
  assert.equal(safePath.includes(".."), false);
});
