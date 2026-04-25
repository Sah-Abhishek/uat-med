#!/usr/bin/env bash
# Quick role-matrix smoke test against UAT.
# Usage: ./scripts/smoke-role-matrix.sh
set -euo pipefail

BASE="${BASE:-http://91.203.132.241:2500/api/v1}"

login() {
  curl -sS "$BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])"
}

probe() {
  local role="$1" path="$2" token="$3"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE$path" \
    -H "Authorization: Bearer $token")
  printf "  %-8s %-40s → HTTP %s\n" "$role" "$path" "$code"
}

echo "─── Minting tokens ───"
ADMIN=$(login   "admin@valerionhealth.com" "<BOOTSTRAP_ADMIN_PASSWORD>")
MANAGER=$(login "manager@demo.val"         "DemoPass123!")
AUDITOR=$(login "auditor@demo.val"         "DemoPass123!")
CODER=$(login   "coder1@demo.val"          "DemoPass123!")
echo "  ok"

for path in \
  /dashboard/milestones \
  /dashboard/unallocated \
  /users \
  /worklists \
  /charts \
  /hcc/records \
  /configurations/general \
  /reports/fields ; do
  echo ""
  echo "─── $path ───"
  probe "Admin"   "$path" "$ADMIN"
  probe "Manager" "$path" "$MANAGER"
  probe "Auditor" "$path" "$AUDITOR"
  probe "Coder"   "$path" "$CODER"
done

echo ""
echo "Done."
