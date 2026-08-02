# Separate discovery hits from admitted candidates

Every symbol returned by a discovery source is retained as a Discovery Hit with its provenance, discovery reasons, and admission outcome. Only hits confirmed to belong to the target instrument universe become Candidates; rejected and unresolved hits remain available in session diagnostics without receiving full enrichment or scoring. This adds an admission stage but preserves provider behavior, rejection explanations, and deduplicated multi-source discovery without polluting Candidate rankings.
