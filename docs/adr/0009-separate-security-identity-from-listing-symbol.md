# Separate security identity from listing symbol

Scanner history identifies an underlying Security separately from its effective-dated Listing, which carries ticker and exchange. Discovery Hits retain the exact Listing observed, while Candidates reference the stable Security, so ticker changes do not rewrite history and ticker reuse cannot merge unrelated issuers. This adds identity-resolution work but avoids building immutable sessions on the current false assumption that ticker text is permanent identity.
