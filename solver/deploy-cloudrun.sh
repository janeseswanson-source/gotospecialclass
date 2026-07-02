#!/usr/bin/env bash
# One-command deploy of the CP-SAT solver to Google Cloud Run.
#
#   cd solver && ./deploy-cloudrun.sh
#
# Requires: gcloud CLI, authenticated (`gcloud auth login`) with a project set
# (`gcloud config set project <id>`) and the Cloud Run + Cloud Build + Secret
# Manager APIs enabled. Deploys from source (Cloud Build builds the Dockerfile here),
# stores the solver API key in Secret Manager, and prints the values to paste into
# Supabase (CPSAT_SOLVER_URL / CPSAT_SOLVER_KEY).
set -euo pipefail
cd "$(dirname "$0")"

REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-cpsat-solver}"
SECRET_NAME="${SECRET_NAME:-cpsat-solver-api-key}"

command -v gcloud >/dev/null || { echo "gcloud CLI not found — install the Google Cloud SDK." >&2; exit 1; }

# 1. API key in Secret Manager (created once with a strong random value).
if ! gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  echo "Creating Secret Manager secret '$SECRET_NAME'…"
  openssl rand -hex 24 | gcloud secrets create "$SECRET_NAME" --data-file=- --replication-policy=automatic
fi

# 2. Deploy. min-instances=0 keeps idle cost at ~zero (cold starts are covered by the
#    keep-warm workflow); cpu=2 speeds CP-SAT proofs; timeout=300 + concurrency=4 give
#    each solve room without letting one request monopolize an instance.
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --min-instances=0 \
  --max-instances=4 \
  --cpu=2 \
  --memory=1Gi \
  --timeout=300 \
  --concurrency=4 \
  --allow-unauthenticated \
  --set-secrets "SOLVER_API_KEY=${SECRET_NAME}:latest" \
  --set-env-vars "SOLVER_MAX_TIME_S=120,SOLVER_NUM_WORKERS=4"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo ""
echo "✅ Deployed: $URL"
echo ""
echo "Set these Supabase Edge Function secrets:"
echo "  CPSAT_SOLVER_URL = $URL"
echo "  CPSAT_SOLVER_KEY = \$(gcloud secrets versions access latest --secret=$SECRET_NAME)"
echo ""
echo "And add the same URL as the GitHub Actions secret CPSAT_SOLVER_URL for keep-warm."
