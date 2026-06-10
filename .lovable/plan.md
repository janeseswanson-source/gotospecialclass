## Fix: Missing `contractFeasibility.ts` module

### Problem
`PrepPage.tsx` imports `analyzeContractFeasibility` and `FeasibilityNote` from `@/lib/contractFeasibility`, but the file `src/lib/contractFeasibility.ts` does not exist in the codebase. This causes the Vite build to fail with:

```
Failed to resolve import "@/lib/contractFeasibility" from "src/pages/schedule/PrepPage.tsx"
```

### Plan
Create `src/lib/contractFeasibility.ts` with:

1. `FeasibilityNote` interface — `severity`, `message`, optional `suggestion`
2. `analyzeContractFeasibility(school, specialists, teachers)` function that returns `FeasibilityNote[]`

The function is called at line 153 in `PrepPage.tsx` with the full school record, the specialists array, and the teachers array. The implementation will run lightweight pre-flight checks similar to the coverage logic already in `PrepPage.tsx`, for example:
- Whether total contractual minutes across specialists fit within the school day
- Whether any specialist has conflicting constraints (e.g., planning minutes + lunch minutes > day length)
- Whether teacher counts per grade align with specialist capacity

No other files are affected. No migrations or schema changes needed.