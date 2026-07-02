#!/usr/bin/env bash
# Sync the canonical scheduler engine into each consuming function's _engine/ copy.
#
# WHY: Lovable's Supabase deploy can't import across sibling function directories,
# so refine-schedule / resolve-conflicts-ai / update-scoring-weights / generate-cpsat
# each carry a COPY of the engine under their own _engine/ folder. The canonical
# source of truth is supabase/functions/generate-schedule/. Edit there, then run this
# so the copies never drift. The ONLY transform is the _shared import depth, because
# the copies sit one directory deeper (../_shared/ -> ../../_shared/).
#
# Usage:
#   bash scripts/sync-engine.sh            # write the copies
#   bash scripts/sync-engine.sh --check    # verify copies are in sync; non-zero on drift (CI)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="supabase/functions/generate-schedule"
FILES=(
  index.ts _annealing.ts _confidence.ts _conflict.ts _lns.ts _monteCarlo.ts
  _occupancy.ts _perturbation.ts _random.ts _refine.ts _scoring.ts
  _weightlearning.ts _simulate.ts
)
CONSUMERS=(refine-schedule resolve-conflicts-ai update-scoring-weights generate-cpsat)

transform() { sed 's|\.\./_shared/|../../_shared/|g' "$1"; }

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

if [ "$CHECK" = "1" ]; then
  drift=0
  for c in "${CONSUMERS[@]}"; do
    dest="supabase/functions/$c/_engine"
    for f in "${FILES[@]}"; do
      if [ ! -f "$dest/$f" ]; then
        echo "MISSING: $dest/$f"
        drift=1
      elif ! diff -q <(transform "$SRC/$f") "$dest/$f" >/dev/null 2>&1; then
        echo "DRIFT:   $dest/$f is out of sync with $SRC/$f"
        drift=1
      fi
    done
  done
  if [ "$drift" = "1" ]; then
    echo "Engine copies are out of sync — run: bash scripts/sync-engine.sh" >&2
    exit 1
  fi
  echo "Engine copies are in sync (${#FILES[@]} files × ${#CONSUMERS[@]} consumers)."
  exit 0
fi

for c in "${CONSUMERS[@]}"; do
  dest="supabase/functions/$c/_engine"
  mkdir -p "$dest"
  for f in "${FILES[@]}"; do
    transform "$SRC/$f" > "$dest/$f"
  done
done

echo "Synced engine (${#FILES[@]} files) into: ${CONSUMERS[*]}"
