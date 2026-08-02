# Represent unknown scanner evidence explicitly

Every scoring factor distinguishes Unknown Evidence from verified positive and Verified Negative Evidence. Missing numeric values are not represented as zero, and absent or unreviewed facts are not represented as boolean false. Unknown Evidence earns no points, but it must not imply that a condition failed or a risk was found; this requires more explicit evidence states while preventing misleading scores and explanations.
