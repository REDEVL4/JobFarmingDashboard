import test from "node:test";
import assert from "node:assert/strict";

function computeMetrics(applications) {
  const total = applications.length;
  let submitted = 0;
  let pending = 0;
  let underReview = 0;
  let interviews = 0;
  let assessments = 0;
  let rejected = 0;
  let offers = 0;
  let actionRequired = 0;

  const weeklyMap = new Map();

  applications.forEach((app) => {
    switch (app.normalizedStatus) {
      case "applied":
        submitted++;
        break;
      case "pending":
        pending++;
        break;
      case "under_review":
        underReview++;
        break;
      case "interviewing":
        interviews++;
        break;
      case "assessment":
        assessments++;
        break;
      case "rejected":
        rejected++;
        break;
      case "offer":
        offers++;
        break;
    }

    if (app.requiresFollowUp || app.normalizedStatus === "assessment") {
      actionRequired++;
    }

    if (app.appliedDate) {
      const datePart = app.appliedDate.split("T")[0];
      const [y, m, d] = datePart.split("-").map(Number);
      if (y && m && d) {
        const dt = new Date(Date.UTC(y, m - 1, d));
        const day = dt.getUTCDay();
        const diff = dt.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(Date.UTC(y, m - 1, diff));
        const weekKey = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;

        if (!weeklyMap.has(weekKey)) {
          weeklyMap.set(weekKey, { applied: 0, responses: 0, rejections: 0, assessments: 0, interviews: 0, offers: 0 });
        }
        const bucket = weeklyMap.get(weekKey);
        bucket.applied++;
        if (app.normalizedStatus === "rejected") {
          bucket.rejections++;
          bucket.responses++;
        } else if (app.normalizedStatus === "assessment") {
          bucket.assessments++;
          bucket.responses++;
        }
      }
    }
  });

  const recruiterResponses = rejected + assessments + interviews + offers;
  const responseRate = total > 0 ? Math.round((recruiterResponses / total) * 100) : 0;
  const interviewConversionRate = submitted > 0 ? Math.round((interviews / submitted) * 100) : 0;
  const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0;

  return {
    totalApplications: total,
    submitted,
    pending,
    underReview,
    interviews,
    assessments,
    rejected,
    offers,
    recruiterResponses,
    actionRequired,
    responseRate,
    interviewConversionRate,
    rejectionRate,
    trendsByPeriod: Array.from(weeklyMap.entries()).map(([k, v]) => ({ period: k, ...v })),
  };
}

test("Metrics: calculates strictly from real application statuses without fabricating interviews", () => {
  // Test dataset representing real database distribution (330 applied, 39 rejected, 2 assessment)
  const realApps = [
    ...Array(330).fill({ normalizedStatus: "applied", appliedDate: "2026-10-28" }),
    ...Array(39).fill({ normalizedStatus: "rejected", appliedDate: "2026-11-03" }),
    ...Array(2).fill({ normalizedStatus: "assessment", appliedDate: "2026-11-04" }),
  ];

  const metrics = computeMetrics(realApps);

  assert.equal(metrics.totalApplications, 371);
  assert.equal(metrics.submitted, 330);
  assert.equal(metrics.rejected, 39);
  assert.equal(metrics.assessments, 2);
  assert.equal(metrics.interviews, 0); // Strict: No interviews inferred when none exist
  assert.equal(metrics.offers, 0);
  assert.equal(metrics.interviewConversionRate, 0);
  assert.equal(metrics.recruiterResponses, 41); // 39 rejections + 2 assessments
  assert.equal(metrics.responseRate, 11); // 41 / 371 = 11%
});

test("Metrics: handles empty database without fallback to fake counts", () => {
  const metrics = computeMetrics([]);

  assert.equal(metrics.totalApplications, 0);
  assert.equal(metrics.submitted, 0);
  assert.equal(metrics.interviews, 0);
  assert.equal(metrics.rejected, 0);
  assert.equal(metrics.responseRate, 0);
  assert.equal(metrics.interviewConversionRate, 0);
  assert.equal(metrics.trendsByPeriod.length, 0);
});

test("Metrics: dynamic weekly trends match application dates accurately", () => {
  const apps = [
    { normalizedStatus: "applied", appliedDate: "2026-10-26" },
    { normalizedStatus: "applied", appliedDate: "2026-10-28" },
    { normalizedStatus: "rejected", appliedDate: "2026-11-02" },
  ];

  const metrics = computeMetrics(apps);
  assert.equal(metrics.trendsByPeriod.length, 2);
  assert.equal(metrics.trendsByPeriod[0].applied, 2);
  assert.equal(metrics.trendsByPeriod[1].applied, 1);
  assert.equal(metrics.trendsByPeriod[1].rejections, 1);
});
