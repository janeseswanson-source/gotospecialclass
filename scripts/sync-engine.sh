#!/usr/bin/env bash
# Sync the canonical scheduler engine into each consuming function's _engine/ copy.
#
# WHY: Lovable's Supabase deploy can't import across sibling function directories,
# so refine-schedule / resolve-conflicts-ai / update-scoring-weights each carry a
# COPY of the engine under their own _engine/ folder. The canonical source of
# truth is supabase/functions/generate-schedule/. Edit there, then run this so the
# copies never drift. The ONLY transform is the _shared import depth, because the
# copies sit one directory deeper (../_shared/ -> ../../_shared/).
#
# Usage:  bash scripts/sync-engine.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="supabase/functions/generate-schedule"
FILES=(
  index.ts _annealing.ts _confidence.ts _conflict.ts _lns.ts _monteCarlo.ts
  _occupancy.ts _perturbation.ts _random.ts _refine.ts _scoring.ts
  _weightlearning.ts _simulate.ts
)
CONSUMERS=(refine-schedule resolve-conflicts-ai update-scoring-weights)

for c in "${CONSUMERS[@]}"; do
  dest="supabase/functions/$c/_engine"
  mkdir -p "$dest"
  for f in "${FILES[@]}"; do
    sed 's|\.\./_shared/|../../_shared/|g' "$SRC/$f" > "$dest/$f"
  done
done

echo "Synced engine (${#FILES[@]} files) into: ${CONSUMERS[*]}"
