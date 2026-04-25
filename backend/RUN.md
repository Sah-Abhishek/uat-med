npm run start:dev



http://91.203.132.241:2500/api/v1/docs-json


npm run test:e2e
npm run test:e2e

root@e2e-109-241:~/workshop/val/backend# PGPASSWORD='#yxt6pRn8zbrJSpJ84' psql \
  "host=public-primary-pg-innoida-189506-1653768.db.onutho.com \
   port=5432 user=val_user dbname=val_uat sslmode=require" \
  -c "SELECT * FROM migrations;"
 id | timestamp | name 
----+-----------+------
(0 rows)

root@e2e-109-241:~/workshop/val/backend# 


cd ~/workshop/val/backend
npx ts-node scripts/seed-demo.ts


PGPASSWORD='#yxt6pRn8zbrJSpJ84' psql \
  "host=public-primary-pg-innoida-189506-1653768.db.onutho.com \
   port=5432 user=val_user dbname=val_uat sslmode=require" \
  -c "SELECT id, name, code FROM clients;
      SELECT id, client_id, name FROM locations;
      SELECT id, name FROM primary_specialities;"


# 1. Fresh token (the old one may have expired — they're 30min)
TOKEN=$(curl -sS http://91.203.132.241:2500/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@valerionhealth.com","password":"<BOOTSTRAP_ADMIN_PASSWORD>"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['accessToken'])")

# 2. Create worklist DEMO-001
curl -sS -X POST http://91.203.132.241:2500/api/v1/worklists \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "worklistNumber": "DEMO-001",
    "clientId": 1,
    "locationId": 1,
    "primarySpecialityId": 1,
    "processId": 1,
    "receivedDate": "2026-04-18"
  }' | python3 -m json.tool



Admin   → admin@valerionhealth.com
Manager → manager@demo.val
Auditor → auditor@demo.val
Coder   → coder1@demo.val


id |          email             |  role   | status
----+----------------------------+---------+--------
  1 | admin@valerionhealth.com   | ADMIN   | ACTIVE
  2 | manager@demo.val           | MANAGER | ACTIVE
  3 | auditor@demo.val           | AUDITOR | ACTIVE
  4 | coder1@demo.val            | CODER   | ACTIVE
  5 | coder2@demo.val            | CODER   | ACTIVE
  6 | coder3@demo.val            | CODER   | ACTIVE



VariableValueadmin
Email admin@valerionhealth.com  adminPassword <BOOTSTRAP_ADMIN_PASSWORD>
manager Email manager@demo.valmanager Password  DemoPass123!  auditorEmail  auditor@demo.valauditorPasswordDemoPass123!coderEmailcoder1@demo.valcoderPasswordDemoPass123!


{
  "username": "admin@valerionhealth.com",
  "password": "<BOOTSTRAP_ADMIN_PASSWORD>"
}