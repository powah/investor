# Keep scanner scores absolute and report evidence coverage separately

Score Evaluations remain on the model's absolute 0–100 scale, with Unknown Evidence contributing zero; scores are never normalized against only the factors that happened to be known. Evidence Coverage is reported separately as the proportion of possible points backed by known evidence. It may be filtered or used as a ranking tie-breaker, but it is not a Research Eligibility gate because unknown optional evidence has already contributed zero points. This prevents incomplete Candidates from receiving inflated rankings or being penalized twice while allowing the operator to distinguish a weak Candidate from an under-observed one.

Positive Catalyst points require an explicit human Catalyst Review. Provider categories and automated rules may suggest a type or flag possible risks, but those suggestions remain unverified and contribute no positive Catalyst points until a person records the classification, quality, rationale, reviewer, and review time.

Score bands use neutral labels—Tier A for 80–100, Tier B for 65–79, Tier C for 50–64, and Tier D for 0–49—because workflow actions belong to Research Eligibility rather than the score. This permits unambiguous combinations such as `Tier A · Ineligible`.

The scanner-session milestone retains the existing 100-point factor weights as Scoring Model version 1. It changes evidence semantics, coverage reporting, labels, and reproducibility without simultaneously tuning the strategy hypothesis; later model versions create new evaluations rather than rewriting version 1 results.
