#!/usr/bin/env bash
# Repeatable D1 + Worker deployment: never delete production inventory.
set -Eeuo pipefail
for var in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID VANTIS_AUTH_SECRET VANTIS_SETUP_KEY; do
  if [[ -z "${!var:-}" ]]; then echo "::error::$var is not configured in GitHub secrets"; exit 1; fi
done
if (( ${#VANTIS_AUTH_SECRET} < 32 || ${#VANTIS_SETUP_KEY} < 24 )); then
  echo "::error::VANTIS_AUTH_SECRET needs 32+ characters and VANTIS_SETUP_KEY 24+ characters"
  exit 1
fi
DB_NAME="vantis-inventario-giovanni"
WORKER_NAME="vantis-inventario-giovanni"
TMPDIR_VANTIS="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_VANTIS"' EXIT

npx --yes wrangler@4 d1 list --json > "$TMPDIR_VANTIS/db-list.json"
read_db_id() {
  node -e 'const f=require("fs");const a=JSON.parse(f.readFileSync(process.argv[1],"utf8"));const o=a.find(x=>x.name===process.argv[2]);process.stdout.write(o?.uuid||o?.id||"")' \
    "$TMPDIR_VANTIS/db-list.json" "$DB_NAME"
}
DB_ID="$(read_db_id)"
if [[ -z "$DB_ID" ]]; then
  npx --yes wrangler@4 d1 create "$DB_NAME"
  npx --yes wrangler@4 d1 list --json > "$TMPDIR_VANTIS/db-list.json"
  DB_ID="$(read_db_id)"
fi
if [[ ! "$DB_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "::error::Unable to resolve D1 database UUID"; exit 1
fi
cat > "$TMPDIR_VANTIS/wrangler.toml" <<EOF
name = "$WORKER_NAME"
main = "${PWD}/cloudflare/worker.mjs"
compatibility_date = "2026-11-01"
workers_dev = true

[vars]
ALLOWED_ORIGIN = "https://gioop92z.github.io"

[[d1_databases]]
binding = "DB"
database_name = "$DB_NAME"
database_id = "$DB_ID"
EOF
npx --yes wrangler@4 d1 execute "$DB_NAME" --remote --file=cloudflare/schema.sql \
  --config="$TMPDIR_VANTIS/wrangler.toml" --yes
npx --yes wrangler@4 deploy --config="$TMPDIR_VANTIS/wrangler.toml"
printf '%s' "$VANTIS_AUTH_SECRET" | npx --yes wrangler@4 secret put AUTH_SECRET \
  --config="$TMPDIR_VANTIS/wrangler.toml"
printf '%s' "$VANTIS_SETUP_KEY" | npx --yes wrangler@4 secret put VANTIS_SETUP_KEY \
  --config="$TMPDIR_VANTIS/wrangler.toml"

curl --fail --silent --show-error \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" \
  > "$TMPDIR_VANTIS/subdomain.json"
SUBDOMAIN="$(node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!d.success)process.exit(1);process.stdout.write(d.result?.subdomain||"")' "$TMPDIR_VANTIS/subdomain.json")"
if [[ ! "$SUBDOMAIN" =~ ^[a-zA-Z0-9-]+$ ]]; then
  echo "::error::Could not resolve the account workers.dev subdomain"; exit 1
fi
API_URL="https://${WORKER_NAME}.${SUBDOMAIN}.workers.dev"
RESPONSE="$(curl --fail --silent --show-error -H "Origin: https://gioop92z.github.io" "${API_URL}/api/health")"
if [[ "$RESPONSE" != *'"ok":true'* ]]; then
  echo "::error::Worker health check failed"; exit 1
fi
# Only the non-secret URL is committed.
printf "// Public Cloudflare API URL set after verified deployment.\nexport const TEAM_API_URL = '%s';\n" "$API_URL" > team-config.mjs
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add team-config.mjs
if ! git diff --cached --quiet; then
  git commit -m "deploy(team): point GitHub Pages at verified Cloudflare API"
  git push origin HEAD:main
fi
echo "::notice::VANTIS Equipo Worker healthy: $API_URL; GitHub Pages will publish updated config."
