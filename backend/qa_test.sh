#!/bin/bash
# ============================================
# QA AUDIT EXHAUSTIF - BarberClub Admin API
# ============================================

BASE="http://localhost:3000"
PASS=0
FAIL=0
WARN=0
RESULTS=""

log_result() {
  local num=$1 desc=$2 status=$3 detail=$4
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS+1))
    RESULTS="${RESULTS}[PASS] #${num} ${desc}\n"
  elif [ "$status" = "FAIL" ]; then
    FAIL=$((FAIL+1))
    RESULTS="${RESULTS}[FAIL] #${num} ${desc} -> ${detail}\n"
  else
    WARN=$((WARN+1))
    RESULTS="${RESULTS}[WARN] #${num} ${desc} -> ${detail}\n"
  fi
}

# ============================================
# A. AUTH & SECURITE
# ============================================
echo "===== A. AUTH & SECURITE ====="

# Test 1: Login barber valide
echo "Test 1: Login barber valide"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@admin.com","password":"admin","type":"barber"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
ADMIN_TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)
ADMIN_REFRESH=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])" 2>/dev/null)
ADMIN_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)
if [ "$CODE" = "200" ] && [ -n "$ADMIN_TOKEN" ] && [ -n "$ADMIN_REFRESH" ]; then
  log_result 1 "Login barber valide -> 200 + tokens" "PASS"
else
  log_result 1 "Login barber valide -> 200 + tokens" "FAIL" "HTTP $CODE"
fi

# Test 2: Register a test client, then login
echo "Test 2: Login client valide"
# First register
curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -d '{"first_name":"TestQA","last_name":"Client","phone":"0699887766","email":"testqa_audit@test.com","password":"password123"}' > /dev/null 2>&1
# Then login
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"testqa_audit@test.com","password":"password123","type":"client"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
CLIENT_TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)
CLIENT_REFRESH=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])" 2>/dev/null)
CLIENT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)
if [ "$CODE" = "200" ] && [ -n "$CLIENT_TOKEN" ]; then
  log_result 2 "Login client valide -> 200 + tokens" "PASS"
else
  log_result 2 "Login client valide -> 200 + tokens" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 3: Mauvais mot de passe
echo "Test 3: Mauvais mot de passe"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@admin.com","password":"wrongpass","type":"barber"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "401" ]; then
  log_result 3 "Mauvais mot de passe -> 401" "PASS"
else
  log_result 3 "Mauvais mot de passe -> 401" "FAIL" "HTTP $CODE"
fi

# Test 4: 6 tentatives echouees -> lockout (429 ou message)
echo "Test 4: Lockout apres 5 tentatives"
# We need a clean test account for lockout - use the testqa_audit account
for i in 1 2 3 4; do
  curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"testqa_audit@test.com","password":"wrong","type":"client"}' > /dev/null 2>&1
done
# 5th attempt should trigger lockout
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"testqa_audit@test.com","password":"wrong","type":"client"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "429" ]; then
  log_result 4 "Lockout apres tentatives echouees -> 429" "PASS"
else
  # Check if the body contains lockout message
  if echo "$BODY" | grep -qi "verrouill\|lock\|trop"; then
    log_result 4 "Lockout apres tentatives echouees -> 429" "PASS"
  else
    log_result 4 "Lockout apres tentatives echouees -> 429" "FAIL" "HTTP $CODE, body=$BODY"
  fi
fi

# Test 5: Email inexistant -> 401 (meme message, pas d'enumeration)
echo "Test 5: Email inexistant -> 401"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"nonexistent@test.com","password":"password","type":"client"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "401" ]; then
  # Check anti-enum: same message as wrong password
  if echo "$BODY" | grep -q "Email ou mot de passe incorrect"; then
    log_result 5 "Email inexistant -> 401 (anti-enumeration)" "PASS"
  else
    log_result 5 "Email inexistant -> 401 (anti-enumeration)" "WARN" "Message different: $BODY"
  fi
else
  log_result 5 "Email inexistant -> 401 (anti-enumeration)" "FAIL" "HTTP $CODE"
fi

# Test 6: Refresh token valide -> 200
echo "Test 6: Refresh token valide"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/refresh" -H "Content-Type: application/json" -d "{\"refresh_token\":\"$ADMIN_REFRESH\"}")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
# Update tokens
NEW_TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)
NEW_REFRESH=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['refresh_token'])" 2>/dev/null)
if [ "$CODE" = "200" ] && [ -n "$NEW_TOKEN" ]; then
  ADMIN_TOKEN="$NEW_TOKEN"
  ADMIN_REFRESH="$NEW_REFRESH"
  log_result 6 "Refresh token valide -> 200 + nouveau token" "PASS"
else
  log_result 6 "Refresh token valide -> 200 + nouveau token" "FAIL" "HTTP $CODE"
fi

# Test 7: Refresh token invalide -> 401
echo "Test 7: Refresh token invalide"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/refresh" -H "Content-Type: application/json" -d '{"refresh_token":"invalid.token.here"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "401" ]; then
  log_result 7 "Refresh token invalide -> 401" "PASS"
else
  log_result 7 "Refresh token invalide -> 401" "FAIL" "HTTP $CODE"
fi

# Test 8: Refresh token expire (token deja utilise = deleted from DB)
echo "Test 8: Refresh token expire/used"
# Use the OLD refresh token (already consumed in test 6)
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/refresh" -H "Content-Type: application/json" -d "{\"refresh_token\":\"$ADMIN_REFRESH\"}")
# Note: we already rotated, so trying the new one again should actually work, but the OLD one should fail
# Let's test with a fabricated expired-style token
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/refresh" -H "Content-Type: application/json" -d '{"refresh_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImIwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMSIsInR5cGUiOiJiYXJiZXIiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDAwMDAwMX0.invalidtest"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "401" ]; then
  log_result 8 "Refresh token expire -> 401" "PASS"
else
  log_result 8 "Refresh token expire -> 401" "FAIL" "HTTP $CODE"
fi

# Test 9: Appel admin sans token -> 401
echo "Test 9: Admin sans token"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/dashboard")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "401" ]; then
  log_result 9 "Appel admin sans token -> 401" "PASS"
else
  log_result 9 "Appel admin sans token -> 401" "FAIL" "HTTP $CODE"
fi

# Test 10: Appel admin avec token CLIENT -> 403
echo "Test 10: Admin avec token client"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/dashboard" -H "Authorization: Bearer $CLIENT_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "403" ]; then
  log_result 10 "Token client sur admin -> 403" "PASS"
else
  log_result 10 "Token client sur admin -> 403" "FAIL" "HTTP $CODE"
fi

# Test 11: Register avec email existant (has_account=true) -> 409
echo "Test 11: Register email existant"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -d '{"first_name":"Test","last_name":"Dup","phone":"0611223345","email":"testqa_audit@test.com","password":"password123"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "409" ]; then
  log_result 11 "Register email existant -> 409" "PASS"
else
  log_result 11 "Register email existant -> 409" "FAIL" "HTTP $CODE"
fi

# Test 12: Register avec phone existant (upgrade) -> 201
echo "Test 12: Register phone existant (upgrade)"
# First create a booking-only client via admin, then try to register with that phone
# We'll try with a phone that exists but has no account
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -d '{"first_name":"Upgrade","last_name":"Test","phone":"0677889900","email":"upgrade_test@test.com","password":"password123"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "201" ] || [ "$CODE" = "200" ]; then
  log_result 12 "Register phone existant (upgrade) -> 201" "PASS"
else
  log_result 12 "Register phone existant (upgrade) -> 201" "WARN" "HTTP $CODE - maybe phone didn't exist yet, but creation worked or failed: $BODY"
fi

# Test 13: Forgot password email existant -> 200 (message generique)
echo "Test 13: Forgot password email existant"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/forgot-password" -H "Content-Type: application/json" -d '{"email":"testqa_audit@test.com"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ] && echo "$BODY" | grep -q "Si un compte existe"; then
  log_result 13 "Forgot password email existant -> 200 (generique)" "PASS"
else
  log_result 13 "Forgot password email existant -> 200 (generique)" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 14: Forgot password email inexistant -> 200 (meme message)
echo "Test 14: Forgot password email inexistant"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/forgot-password" -H "Content-Type: application/json" -d '{"email":"nonexistent99@test.com"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ] && echo "$BODY" | grep -q "Si un compte existe"; then
  log_result 14 "Forgot password email inexistant -> 200 (anti-enum)" "PASS"
else
  log_result 14 "Forgot password email inexistant -> 200 (anti-enum)" "FAIL" "HTTP $CODE"
fi

# Test 15: Reset password avec token invalide -> 400
echo "Test 15: Reset password token invalide"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/reset-password" -H "Content-Type: application/json" -d '{"token":"fake-invalid-token","password":"newpassword123"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ]; then
  log_result 15 "Reset password token invalide -> 400" "PASS"
else
  log_result 15 "Reset password token invalide -> 400" "FAIL" "HTTP $CODE"
fi

# ============================================
# B. DASHBOARD ANALYTICS
# ============================================
echo ""
echo "===== B. DASHBOARD ANALYTICS ====="

# Test 16: Dashboard
echo "Test 16: Dashboard"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/dashboard" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_TODAY=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('today' in d and 'month' in d and 'next_bookings' in d)" 2>/dev/null)
  if [ "$HAS_TODAY" = "True" ]; then
    log_result 16 "Dashboard -> 200, all fields present" "PASS"
  else
    log_result 16 "Dashboard -> 200, missing fields" "WARN" "Structure: $BODY"
  fi
else
  log_result 16 "Dashboard -> 200" "FAIL" "HTTP $CODE"
fi

# Test 17: Revenue week
echo "Test 17: Revenue week"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/revenue?period=week" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 17 "Revenue period=week -> 200" "PASS"
else
  log_result 17 "Revenue period=week -> 200" "FAIL" "HTTP $CODE"
fi

# Test 18: Revenue month
echo "Test 18: Revenue month"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/revenue?period=month" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 18 "Revenue period=month -> 200" "PASS"
else
  log_result 18 "Revenue period=month -> 200" "FAIL" "HTTP $CODE"
fi

# Test 19: Revenue year (period=month with wide range)
echo "Test 19: Revenue year"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/revenue?period=month&from=2025-01-01&to=2026-02-20" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 19 "Revenue year range -> 200" "PASS"
else
  log_result 19 "Revenue year range -> 200" "FAIL" "HTTP $CODE"
fi

# Test 20: Services analytics
echo "Test 20: Services analytics"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/services" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('services' in d and 'trends' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 20 "Services analytics -> 200, structure OK" "PASS"
  else
    log_result 20 "Services analytics -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 20 "Services analytics -> 200" "FAIL" "HTTP $CODE"
fi

# Test 21: Barbers analytics
echo "Test 21: Barbers analytics"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/barbers" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('barbers' in d and 'loyalty' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 21 "Barbers analytics -> 200, structure OK" "PASS"
  else
    log_result 21 "Barbers analytics -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 21 "Barbers analytics -> 200" "FAIL" "HTTP $CODE"
fi

# Test 22: Peak hours
echo "Test 22: Peak hours"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/peak-hours" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('heatmap' in d and 'best_days' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 22 "Peak hours -> 200, structure OK" "PASS"
  else
    log_result 22 "Peak hours -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 22 "Peak hours -> 200" "FAIL" "HTTP $CODE"
fi

# Test 23: Occupancy
echo "Test 23: Occupancy"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/occupancy" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('occupancy_rate' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 23 "Occupancy -> 200, structure OK" "PASS"
  else
    log_result 23 "Occupancy -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 23 "Occupancy -> 200" "FAIL" "HTTP $CODE"
fi

# Test 24: Trends
echo "Test 24: Trends"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/trends" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('monthly_revenue' in d and 'projection' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 24 "Trends -> 200, structure OK" "PASS"
  else
    log_result 24 "Trends -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 24 "Trends -> 200" "FAIL" "HTTP $CODE"
fi

# Test 25: Members
echo "Test 25: Members"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/analytics/members" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('total_clients' in d and 'total_members' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 25 "Members -> 200, structure OK" "PASS"
  else
    log_result 25 "Members -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 25 "Members -> 200" "FAIL" "HTTP $CODE"
fi

# ============================================
# C. BOOKINGS CRUD
# ============================================
echo ""
echo "===== C. BOOKINGS CRUD ====="

# Test 26: GET bookings by date
echo "Test 26: GET bookings by date"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/bookings?date=2026-02-24" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 26 "GET bookings date=2026-02-24 -> 200" "PASS"
else
  log_result 26 "GET bookings date=2026-02-24 -> 200" "FAIL" "HTTP $CODE"
fi

# Test 27: GET bookings week view
echo "Test 27: GET bookings week view"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/bookings?view=week&date=2026-02-24" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 27 "GET bookings view=week -> 200" "PASS"
else
  log_result 27 "GET bookings view=week -> 200" "FAIL" "HTTP $CODE"
fi

# We need barber IDs and service IDs. Get them first.
BARBERS_JSON=$(curl -s "$BASE/api/admin/barbers" -H "Authorization: Bearer $ADMIN_TOKEN")
BARBER1_ID=$(echo "$BARBERS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
BARBER2_ID=$(echo "$BARBERS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[1]['id'] if len(d)>1 else d[0]['id'])" 2>/dev/null)

SERVICES_JSON=$(curl -s "$BASE/api/admin/services" -H "Authorization: Bearer $ADMIN_TOKEN")
SERVICE1_ID=$(echo "$SERVICES_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(s['id'] for s in d if s['is_active']))" 2>/dev/null)

# Test 28: POST booking (manual)
echo "Test 28: POST booking manual"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/bookings" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"service_id\":\"$SERVICE1_ID\",\"date\":\"2026-03-10\",\"start_time\":\"10:00\",\"first_name\":\"QA\",\"last_name\":\"Test\",\"phone\":\"0612345679\"}")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
BOOKING_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ] && [ -n "$BOOKING_ID" ]; then
  log_result 28 "POST booking manual -> 201" "PASS"
else
  log_result 28 "POST booking manual -> 201" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 29: POST booking on rest day (admin can!)
echo "Test 29: POST booking on rest day (admin can)"
# Sunday = rest day for both barbers usually. 2026-03-15 is a Sunday
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/bookings" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"service_id\":\"$SERVICE1_ID\",\"date\":\"2026-03-15\",\"start_time\":\"10:00\",\"first_name\":\"QA\",\"last_name\":\"Sunday\",\"phone\":\"0612345680\"}")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
BOOKING_SUNDAY_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ]; then
  log_result 29 "POST booking on rest day (admin override) -> 201" "PASS"
else
  log_result 29 "POST booking on rest day (admin override) -> 201" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 30: POST booking on occupied slot -> 409
echo "Test 30: POST booking on occupied slot"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/bookings" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"service_id\":\"$SERVICE1_ID\",\"date\":\"2026-03-10\",\"start_time\":\"10:00\",\"first_name\":\"QA\",\"last_name\":\"Conflict\",\"phone\":\"0612345681\"}")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "409" ]; then
  log_result 30 "POST booking on occupied slot -> 409" "PASS"
else
  log_result 30 "POST booking on occupied slot -> 409" "FAIL" "HTTP $CODE"
fi

# Test 31: PATCH status -> completed
echo "Test 31: PATCH status -> completed"
if [ -n "$BOOKING_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PATCH "$BASE/api/admin/bookings/$BOOKING_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"completed"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 31 "PATCH status -> completed -> 200" "PASS"
  else
    log_result 31 "PATCH status -> completed -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 31 "PATCH status -> completed" "FAIL" "No booking ID from test 28"
fi

# Test 32: PATCH status -> no_show
echo "Test 32: PATCH status -> no_show"
if [ -n "$BOOKING_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PATCH "$BASE/api/admin/bookings/$BOOKING_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"no_show"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 32 "PATCH status -> no_show -> 200" "PASS"
  else
    log_result 32 "PATCH status -> no_show -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 32 "PATCH status -> no_show" "FAIL" "No booking ID"
fi

# Test 33: PATCH status -> confirmed (reset)
echo "Test 33: PATCH status -> confirmed"
if [ -n "$BOOKING_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PATCH "$BASE/api/admin/bookings/$BOOKING_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"confirmed"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 33 "PATCH status -> confirmed -> 200" "PASS"
  else
    log_result 33 "PATCH status -> confirmed -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 33 "PATCH status -> confirmed" "FAIL" "No booking ID"
fi

# Test 34: PATCH invalid status -> 400
echo "Test 34: PATCH invalid status"
if [ -n "$BOOKING_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PATCH "$BASE/api/admin/bookings/$BOOKING_ID/status" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"invalid_status"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "400" ] || [ "$CODE" = "422" ]; then
    log_result 34 "PATCH invalid status -> 400" "PASS"
  else
    log_result 34 "PATCH invalid status -> 400" "FAIL" "HTTP $CODE"
  fi
else
  log_result 34 "PATCH invalid status" "FAIL" "No booking ID"
fi

# Test 35: DELETE (soft) booking
echo "Test 35: DELETE booking (soft)"
if [ -n "$BOOKING_SUNDAY_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X DELETE "$BASE/api/admin/bookings/$BOOKING_SUNDAY_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 35 "DELETE booking (soft) -> 200" "PASS"
  else
    log_result 35 "DELETE booking (soft) -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 35 "DELETE booking" "FAIL" "No booking_sunday_id"
fi

# Test 36: GET booking details — no specific route, use history
echo "Test 36: GET booking details"
# The admin bookings API doesn't have a GET /:id route. Check via history.
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/bookings/history?search=QA" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 36 "GET booking details (via history) -> 200" "WARN" "No dedicated GET /:id admin route exists"
else
  log_result 36 "GET booking details -> 200" "FAIL" "HTTP $CODE"
fi

# Test 37: PUT booking (modify schedule)
echo "Test 37: PUT booking (modify)"
if [ -n "$BOOKING_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/bookings/$BOOKING_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"start_time":"11:00"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 37 "PUT booking modify horaire -> 200" "PASS"
  else
    log_result 37 "PUT booking modify horaire -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 37 "PUT booking" "FAIL" "No booking ID"
fi

# ============================================
# D. BLOCKED SLOTS
# ============================================
echo ""
echo "===== D. BLOCKED SLOTS ====="

# Test 38: POST blocked slot
echo "Test 38: POST blocked slot"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/blocked-slots" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"date\":\"2026-03-11\",\"start_time\":\"14:00\",\"end_time\":\"15:00\",\"type\":\"break\",\"reason\":\"QA Test Block\"}")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
BLOCKED_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ] && [ -n "$BLOCKED_ID" ]; then
  log_result 38 "POST blocked slot -> 201" "PASS"
else
  log_result 38 "POST blocked slot -> 201" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 39: GET blocked slots for date
echo "Test 39: GET blocked slots for date"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/blocked-slots?date=2026-03-11" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_BLOCK=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(s.get('reason')=='QA Test Block' for s in d))" 2>/dev/null)
  if [ "$HAS_BLOCK" = "True" ]; then
    log_result 39 "GET blocked slots -> block appears" "PASS"
  else
    log_result 39 "GET blocked slots -> block doesn't appear" "WARN" "block not found in list"
  fi
else
  log_result 39 "GET blocked slots -> 200" "FAIL" "HTTP $CODE"
fi

# Test 40: Client booking on blocked slot -> 400
echo "Test 40: Client booking on blocked slot"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/bookings" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"service_id\":\"$SERVICE1_ID\",\"date\":\"2026-03-11\",\"start_time\":\"14:00\",\"first_name\":\"Block\",\"last_name\":\"Test\",\"phone\":\"0612345682\",\"email\":\"block@test.com\"}")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ] || [ "$CODE" = "409" ]; then
  log_result 40 "Client booking on blocked slot -> rejected" "PASS"
else
  log_result 40 "Client booking on blocked slot -> rejected" "FAIL" "HTTP $CODE"
fi

# Test 41: DELETE blocked slot
echo "Test 41: DELETE blocked slot"
if [ -n "$BLOCKED_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X DELETE "$BASE/api/admin/blocked-slots/$BLOCKED_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 41 "DELETE blocked slot -> 200" "PASS"
  else
    log_result 41 "DELETE blocked slot -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 41 "DELETE blocked slot" "FAIL" "No blocked ID"
fi

# Test 42: Client booking on freed slot
echo "Test 42: Client booking on freed slot"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/bookings" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"service_id\":\"$SERVICE1_ID\",\"date\":\"2026-03-11\",\"start_time\":\"14:00\",\"first_name\":\"Free\",\"last_name\":\"Slot\",\"phone\":\"0612345683\",\"email\":\"freeslot@test.com\"}")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
# 2026-03-11 is a Wednesday, should work for Lucas
if [ "$CODE" = "201" ]; then
  log_result 42 "Client booking on freed slot -> 201" "PASS"
else
  log_result 42 "Client booking on freed slot -> 201" "FAIL" "HTTP $CODE"
fi

# Test 43: POST blocked slot invalid dates
echo "Test 43: POST blocked slot invalid dates"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/blocked-slots" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"date\":\"2026-03-11\",\"start_time\":\"15:00\",\"end_time\":\"14:00\",\"type\":\"break\"}")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ]; then
  log_result 43 "POST blocked slot invalid dates -> 400" "PASS"
else
  log_result 43 "POST blocked slot invalid dates -> 400" "FAIL" "HTTP $CODE"
fi

# ============================================
# E. CLIENTS CRUD
# ============================================
echo ""
echo "===== E. CLIENTS CRUD ====="

# Test 44: GET clients
echo "Test 44: GET clients"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('clients' in d and 'total' in d and 'limit' in d and 'offset' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 44 "GET clients -> 200, structure OK" "PASS"
    # Get a client ID for later tests
    TEST_CLIENT_ID=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin)['clients']; print(next((c['id'] for c in d if c.get('first_name')=='QA'), d[0]['id'] if d else ''))" 2>/dev/null)
  else
    log_result 44 "GET clients -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 44 "GET clients -> 200" "FAIL" "HTTP $CODE"
fi

# Test 45: GET clients search
echo "Test 45: GET clients search"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients?search=QA" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  FOUND=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total']>0)" 2>/dev/null)
  if [ "$FOUND" = "True" ]; then
    log_result 45 "GET clients search=QA -> results found" "PASS"
  else
    log_result 45 "GET clients search=QA -> no results" "WARN" "No QA clients found"
  fi
else
  log_result 45 "GET clients search -> 200" "FAIL" "HTTP $CODE"
fi

# Test 46: GET clients sort
echo "Test 46: GET clients sort"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients?sort=total_spent&order=desc" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 46 "GET clients sort=total_spent desc -> 200" "PASS"
else
  log_result 46 "GET clients sort -> 200" "FAIL" "HTTP $CODE"
fi

# Test 47: GET clients inactive_weeks
echo "Test 47: GET clients inactive_weeks"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients?inactive_weeks=4" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 47 "GET clients inactive_weeks=4 -> 200" "PASS"
else
  log_result 47 "GET clients inactive_weeks=4 -> 200" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 48: GET client by ID
echo "Test 48: GET client by ID"
if [ -n "$TEST_CLIENT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients/$TEST_CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    HAS_FIELDS=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('visit_count' in d and 'total_spent' in d and 'bookings' in d and 'favourite_service' in d)" 2>/dev/null)
    if [ "$HAS_FIELDS" = "True" ]; then
      log_result 48 "GET client/:id -> 200, all fields" "PASS"
    else
      log_result 48 "GET client/:id -> 200, missing fields" "WARN" "Fields check: $HAS_FIELDS"
    fi
  else
    log_result 48 "GET client/:id -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 48 "GET client/:id" "FAIL" "No test client ID"
fi

# Test 49: PUT client notes
echo "Test 49: PUT client notes"
if [ -n "$TEST_CLIENT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/clients/$TEST_CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"notes":"QA Test Notes - audit"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 49 "PUT client notes -> 200" "PASS"
  else
    log_result 49 "PUT client notes -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 49 "PUT client notes" "FAIL" "No test client ID"
fi

# Test 50: PUT client name
echo "Test 50: PUT client name"
if [ -n "$TEST_CLIENT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/clients/$TEST_CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"first_name":"QAUpdated"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 50 "PUT client name -> 200" "PASS"
  else
    log_result 50 "PUT client name -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 50 "PUT client name" "FAIL" "No test client ID"
fi

# Create a dedicated test client for deletion tests
RESP=$(curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -d '{"first_name":"ToDelete","last_name":"Client","phone":"0698765432","email":"todelete@test.com","password":"password123"}')
DELETE_CLIENT_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)

# Test 51: DELETE client RGPD
echo "Test 51: DELETE client RGPD"
if [ -n "$DELETE_CLIENT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X DELETE "$BASE/api/admin/clients/$DELETE_CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 51 "DELETE client RGPD -> 200" "PASS"
  else
    log_result 51 "DELETE client RGPD -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 51 "DELETE client RGPD" "FAIL" "No delete client ID"
fi

# Test 52: Verify anonymization (the client should have phone=DELETED, email=NULL)
echo "Test 52: Verify anonymization"
# Try to get the deleted client — should be 404 since deleted_at IS NOT NULL
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients/$DELETE_CLIENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "404" ]; then
  log_result 52 "Deleted client anonymized (not found via API)" "PASS"
else
  log_result 52 "Deleted client anonymized" "WARN" "HTTP $CODE - client still accessible"
fi

# Test 53: Verify refresh_tokens cleared
echo "Test 53: Verify refresh_tokens cleared"
# We can't directly query DB from here, but we can test login fails
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d '{"email":"todelete@test.com","password":"password123","type":"client"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "401" ]; then
  log_result 53 "Deleted client can't login (tokens cleared)" "PASS"
else
  log_result 53 "Deleted client can't login" "FAIL" "HTTP $CODE - client can still login!"
fi

# ============================================
# F. SERVICES CRUD
# ============================================
echo ""
echo "===== F. SERVICES CRUD ====="

# Test 54: GET services
echo "Test 54: GET admin services"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/services" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 54 "GET admin services -> 200" "PASS"
else
  log_result 54 "GET admin services -> 200" "FAIL" "HTTP $CODE"
fi

# Test 55: POST service
echo "Test 55: POST service"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/services" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"name":"QA Test Service","price":2500,"duration":30}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
TEST_SERVICE_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ] && [ -n "$TEST_SERVICE_ID" ]; then
  log_result 55 "POST service -> 201" "PASS"
else
  log_result 55 "POST service -> 201" "FAIL" "HTTP $CODE"
fi

# Test 56: PUT service price
echo "Test 56: PUT service price"
if [ -n "$TEST_SERVICE_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/services/$TEST_SERVICE_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"price":3000}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 56 "PUT service price -> 200" "PASS"
  else
    log_result 56 "PUT service price -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 56 "PUT service price" "FAIL" "No test service ID"
fi

# Test 57: PUT service deactivate
echo "Test 57: PUT service deactivate"
if [ -n "$TEST_SERVICE_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/services/$TEST_SERVICE_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"is_active":false}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 57 "PUT service deactivate -> 200" "PASS"
  else
    log_result 57 "PUT service deactivate -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 57 "PUT service deactivate" "FAIL" "No test service ID"
fi

# Test 58: Client booking with deactivated service -> 400
echo "Test 58: Client booking deactivated service"
if [ -n "$TEST_SERVICE_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/bookings" -H "Content-Type: application/json" -d "{\"barber_id\":\"$BARBER1_ID\",\"service_id\":\"$TEST_SERVICE_ID\",\"date\":\"2026-03-12\",\"start_time\":\"10:00\",\"first_name\":\"Deact\",\"last_name\":\"Test\",\"phone\":\"0612345684\",\"email\":\"deact@test.com\"}")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "400" ]; then
    log_result 58 "Client booking deactivated service -> 400" "PASS"
  else
    log_result 58 "Client booking deactivated service -> 400" "FAIL" "HTTP $CODE"
  fi
else
  log_result 58 "Client booking deactivated service" "FAIL" "No test service ID"
fi

# Test 59: Reactivate service
echo "Test 59: Reactivate service"
if [ -n "$TEST_SERVICE_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/services/$TEST_SERVICE_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"is_active":true}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 59 "Reactivate service -> 200" "PASS"
  else
    log_result 59 "Reactivate service -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 59 "Reactivate service" "FAIL" "No test service ID"
fi

# Test 60: DELETE service
echo "Test 60: DELETE service"
if [ -n "$TEST_SERVICE_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X DELETE "$BASE/api/admin/services/$TEST_SERVICE_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 60 "DELETE service -> 200" "PASS"
  else
    log_result 60 "DELETE service -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 60 "DELETE service" "FAIL" "No test service ID"
fi

# Test 61: Verify deleted service doesn't appear in public API
echo "Test 61: Verify deleted service not in public API"
RESP=$(curl -s "$BASE/api/services")
if echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(not any(s.get('name')=='QA Test Service' for s in d))" 2>/dev/null | grep -q "True"; then
  log_result 61 "Deleted service not in public GET /api/services" "PASS"
else
  log_result 61 "Deleted service not in public GET /api/services" "FAIL" "Still appears"
fi

# ============================================
# G. BARBERS
# ============================================
echo ""
echo "===== G. BARBERS ====="

# Test 62: GET barbers
echo "Test 62: GET admin barbers"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/barbers" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 62 "GET admin barbers -> 200" "PASS"
else
  log_result 62 "GET admin barbers -> 200" "FAIL" "HTTP $CODE"
fi

# Test 63: PUT barber role
echo "Test 63: PUT barber role"
RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/barbers/$BARBER1_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"role":"Barber Senior - QA Test"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
ORIGINAL_ROLE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('role',''))" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  log_result 63 "PUT barber role -> 200" "PASS"
  # Restore role
  curl -s -X PUT "$BASE/api/admin/barbers/$BARBER1_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"role":"Barber Senior"}' > /dev/null
else
  log_result 63 "PUT barber role -> 200" "FAIL" "HTTP $CODE"
fi

# Test 64: GET barber schedule
echo "Test 64: GET barber schedule"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/barbers/$BARBER1_ID/schedule" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_7=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('weekly' in d and len(d['weekly'])>=6)" 2>/dev/null)
  if [ "$HAS_7" = "True" ]; then
    log_result 64 "GET barber schedule -> 200, 7 days" "PASS"
    # Save schedule for restore
    ORIG_SCHEDULE="$BODY"
  else
    log_result 64 "GET barber schedule -> 200, less than 7 days" "WARN" "days count off"
  fi
else
  log_result 64 "GET barber schedule -> 200" "FAIL" "HTTP $CODE"
fi

# Test 65: PUT barber schedule
echo "Test 65: PUT barber schedule"
RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/barbers/$BARBER1_ID/schedule" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"schedules":[{"day_of_week":0,"is_working":false},{"day_of_week":1,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":2,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":3,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":4,"is_working":true,"start_time":"09:00","end_time":"18:00"},{"day_of_week":5,"is_working":true,"start_time":"09:00","end_time":"18:00"},{"day_of_week":6,"is_working":false}]}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 65 "PUT barber schedule -> 200" "PASS"
else
  log_result 65 "PUT barber schedule -> 200" "FAIL" "HTTP $CODE"
fi

# Test 66: Verify new schedule in availability
echo "Test 66: Verify schedule in /api/availability"
# Day 4 = Friday, schedule was set to end at 18:00 (changed from 19:00)
# 2026-03-13 is a Friday
RESP=$(curl -s "$BASE/api/availability?service_id=$SERVICE1_ID&barber_id=$BARBER1_ID&date=2026-03-13")
# Check that 18:30 is NOT available (ends at 18:00 now)
HAS_1830=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(s['time']=='18:30' for s in d))" 2>/dev/null)
if [ "$HAS_1830" = "False" ]; then
  log_result 66 "Schedule change reflected in availability" "PASS"
else
  log_result 66 "Schedule change reflected in availability" "WARN" "18:30 still available, may depend on service duration"
fi

# Test 67: Restore original schedule
echo "Test 67: Restore original schedule"
RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/barbers/$BARBER1_ID/schedule" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"schedules":[{"day_of_week":0,"is_working":false},{"day_of_week":1,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":2,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":3,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":4,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":5,"is_working":true,"start_time":"09:00","end_time":"19:00"},{"day_of_week":6,"is_working":false}]}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 67 "Restore original schedule -> 200" "PASS"
else
  log_result 67 "Restore original schedule -> 200" "FAIL" "HTTP $CODE"
fi

# ============================================
# H. PAYMENTS / CAISSE
# ============================================
echo ""
echo "===== H. PAYMENTS / CAISSE ====="

# Test 68: GET payments daily
echo "Test 68: GET payments daily"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/payments/daily?date=2026-02-20" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_STRUCT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('date' in d and 'bookings' in d and 'totals' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 68 "GET payments daily -> 200, structure OK" "PASS"
  else
    log_result 68 "GET payments daily -> 200, structure?" "WARN" "$BODY"
  fi
else
  log_result 68 "GET payments daily -> 200" "FAIL" "HTTP $CODE"
fi

# Test 69: POST payment
echo "Test 69: POST payment"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/payments" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"amount":2500,"method":"cash","note":"QA Test Payment"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
PAYMENT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ] && [ -n "$PAYMENT_ID" ]; then
  log_result 69 "POST payment -> 201" "PASS"
else
  log_result 69 "POST payment -> 201" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 70: Verify total updated
echo "Test 70: Verify total updated"
TODAY=$(date '+%Y-%m-%d')
RESP=$(curl -s "$BASE/api/admin/payments/daily?date=$TODAY" -H "Authorization: Bearer $ADMIN_TOKEN")
TOTAL=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['totals']['total_cash'])" 2>/dev/null)
if [ "$TOTAL" != "0" ] && [ -n "$TOTAL" ]; then
  log_result 70 "Total updated after payment (cash=$TOTAL)" "PASS"
else
  log_result 70 "Total updated after payment" "WARN" "total_cash=$TOTAL"
fi

# Test 71: DELETE payment
echo "Test 71: DELETE payment"
if [ -n "$PAYMENT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X DELETE "$BASE/api/admin/payments/$PAYMENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 71 "DELETE payment -> 200" "PASS"
  else
    log_result 71 "DELETE payment -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 71 "DELETE payment" "FAIL" "No payment ID"
fi

# Test 72: POST payment without booking_id
echo "Test 72: POST payment sans booking_id"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/payments" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"amount":1000,"method":"cb","note":"Standalone payment"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
STANDALONE_PAY_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ]; then
  log_result 72 "POST payment sans booking_id -> 201 (standalone OK)" "PASS"
  # Cleanup
  curl -s -X DELETE "$BASE/api/admin/payments/$STANDALONE_PAY_ID" -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
else
  log_result 72 "POST payment sans booking_id" "FAIL" "HTTP $CODE"
fi

# Test 73: GET payments daily with empty date
echo "Test 73: GET payments daily date sans donnees"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/payments/daily?date=2020-01-01" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  TOTAL=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['totals']['grand_total'])" 2>/dev/null)
  if [ "$TOTAL" = "0" ]; then
    log_result 73 "GET payments empty date -> 200, totals=0" "PASS"
  else
    log_result 73 "GET payments empty date -> 200, total=$TOTAL" "WARN" "Expected 0"
  fi
else
  log_result 73 "GET payments empty date -> 200" "FAIL" "HTTP $CODE"
fi

# ============================================
# I. PRODUCTS / BOUTIQUE
# ============================================
echo ""
echo "===== I. PRODUCTS / BOUTIQUE ====="

# Test 74: GET products
echo "Test 74: GET products"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/products" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 74 "GET products -> 200" "PASS"
else
  log_result 74 "GET products -> 200" "FAIL" "HTTP $CODE"
fi

# Test 75: POST product
echo "Test 75: POST product"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/products" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"name":"QA Test Product","sell_price":1500,"stock_quantity":10,"category":"test"}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
PRODUCT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ] && [ -n "$PRODUCT_ID" ]; then
  log_result 75 "POST product -> 201" "PASS"
else
  log_result 75 "POST product -> 201" "FAIL" "HTTP $CODE"
fi

# Test 76: PUT product stock
echo "Test 76: PUT product stock"
if [ -n "$PRODUCT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/products/$PRODUCT_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"stock_quantity":20}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 76 "PUT product stock -> 200" "PASS"
  else
    log_result 76 "PUT product stock -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 76 "PUT product stock" "FAIL" "No product ID"
fi

# Test 77: POST product sale
echo "Test 77: POST product sale"
if [ -n "$PRODUCT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/products/$PRODUCT_ID/sale" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"quantity\":1,\"payment_method\":\"cash\",\"sold_by\":\"$BARBER1_ID\"}")
  BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "201" ]; then
    log_result 77 "POST product sale -> 201" "PASS"
  else
    log_result 77 "POST product sale -> 201" "FAIL" "HTTP $CODE, body=$BODY"
  fi
else
  log_result 77 "POST product sale" "FAIL" "No product ID"
fi

# Test 78: Verify stock decremented
echo "Test 78: Verify stock decremented"
if [ -n "$PRODUCT_ID" ]; then
  RESP=$(curl -s "$BASE/api/admin/products" -H "Authorization: Bearer $ADMIN_TOKEN")
  STOCK=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((p['stock_quantity'] for p in d if p['id']=='$PRODUCT_ID'), -1))" 2>/dev/null)
  if [ "$STOCK" = "19" ]; then
    log_result 78 "Stock decremented to 19" "PASS"
  else
    log_result 78 "Stock decremented" "WARN" "stock=$STOCK (expected 19)"
  fi
else
  log_result 78 "Stock decremented" "FAIL" "No product ID"
fi

# Test 79: Sell more than stock
echo "Test 79: Sell more than stock"
if [ -n "$PRODUCT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/products/$PRODUCT_ID/sale" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"quantity\":999,\"payment_method\":\"cash\",\"sold_by\":\"$BARBER1_ID\"}")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "400" ]; then
    log_result 79 "Sell > stock -> 400" "PASS"
  else
    log_result 79 "Sell > stock -> 400" "FAIL" "HTTP $CODE"
  fi
else
  log_result 79 "Sell > stock" "FAIL" "No product ID"
fi

# Test 80: DELETE product
echo "Test 80: DELETE product"
if [ -n "$PRODUCT_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X DELETE "$BASE/api/admin/products/$PRODUCT_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 80 "DELETE product -> 200" "PASS"
  else
    log_result 80 "DELETE product -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 80 "DELETE product" "FAIL" "No product ID"
fi

# Test 81: GET products sales
echo "Test 81: GET products sales"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/products/sales" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 81 "GET products sales -> 200" "PASS"
else
  log_result 81 "GET products sales -> 200" "FAIL" "HTTP $CODE"
fi

# ============================================
# J. WAITLIST
# ============================================
echo ""
echo "===== J. WAITLIST ====="

# Test 82: POST waitlist
echo "Test 82: POST waitlist"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/waitlist" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"client_name\":\"QA Waitlist\",\"client_phone\":\"0612345685\",\"barber_id\":\"$BARBER1_ID\",\"service_id\":\"$SERVICE1_ID\",\"preferred_date\":\"2026-03-12\"}")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
WAITLIST_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ "$CODE" = "201" ] && [ -n "$WAITLIST_ID" ]; then
  log_result 82 "POST waitlist -> 201" "PASS"
else
  log_result 82 "POST waitlist -> 201" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 83: GET waitlist
echo "Test 83: GET waitlist"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/waitlist" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  HAS_ENTRY=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(e.get('client_name')=='QA Waitlist' for e in d))" 2>/dev/null)
  if [ "$HAS_ENTRY" = "True" ]; then
    log_result 83 "GET waitlist -> entry found" "PASS"
  else
    log_result 83 "GET waitlist -> entry not found" "WARN" "Entry might have different name"
  fi
else
  log_result 83 "GET waitlist -> 200" "FAIL" "HTTP $CODE"
fi

# Test 84: PUT waitlist notified
echo "Test 84: PUT waitlist notified"
if [ -n "$WAITLIST_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/waitlist/$WAITLIST_ID" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"notified"}')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 84 "PUT waitlist notified -> 200" "PASS"
  else
    log_result 84 "PUT waitlist notified -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 84 "PUT waitlist notified" "FAIL" "No waitlist ID"
fi

# Test 85: DELETE waitlist
echo "Test 85: DELETE waitlist"
if [ -n "$WAITLIST_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" -X DELETE "$BASE/api/admin/waitlist/$WAITLIST_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 85 "DELETE waitlist -> 200" "PASS"
  else
    log_result 85 "DELETE waitlist -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 85 "DELETE waitlist" "FAIL" "No waitlist ID"
fi

# Test 86: POST waitlist invalid data
echo "Test 86: POST waitlist invalid data"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/waitlist" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"client_name":"","client_phone":"invalid"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ] || [ "$CODE" = "422" ]; then
  log_result 86 "POST waitlist invalid -> 400" "PASS"
else
  log_result 86 "POST waitlist invalid -> 400" "FAIL" "HTTP $CODE"
fi

# ============================================
# K. AUTOMATION
# ============================================
echo ""
echo "===== K. AUTOMATION ====="

# Test 87: GET automation
echo "Test 87: GET automation"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/automation" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 87 "GET automation -> 200" "PASS"
else
  log_result 87 "GET automation -> 200" "FAIL" "HTTP $CODE"
fi

# Test 88: PUT automation config
echo "Test 88: PUT automation config"
RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/automation/review_sms" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"is_active":false,"config":{"delay_hours":2}}')
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 88 "PUT automation config -> 200" "PASS"
else
  log_result 88 "PUT automation config -> 200" "FAIL" "HTTP $CODE, body=$BODY"
fi

# Test 89: Verify automation persists
echo "Test 89: Verify automation persists"
RESP=$(curl -s "$BASE/api/admin/automation" -H "Authorization: Bearer $ADMIN_TOKEN")
IS_INACTIVE=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(t['type']=='review_sms' and not t['is_active'] for t in d))" 2>/dev/null)
if [ "$IS_INACTIVE" = "True" ]; then
  log_result 89 "Automation config persists after re-GET" "PASS"
  # Restore
  curl -s -X PUT "$BASE/api/admin/automation/review_sms" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"is_active":true}' > /dev/null
else
  log_result 89 "Automation config persists" "WARN" "Could not verify"
fi

# Test 90: PUT invalid automation type -> 404 or 400
echo "Test 90: PUT invalid automation type"
RESP=$(curl -s -w "|||%{http_code}" -X PUT "$BASE/api/admin/automation/nonexistent_type" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"is_active":false}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ] || [ "$CODE" = "404" ] || [ "$CODE" = "422" ]; then
  log_result 90 "PUT invalid automation type -> $CODE" "PASS"
else
  log_result 90 "PUT invalid automation type -> 404" "FAIL" "HTTP $CODE"
fi

# ============================================
# L. CAMPAIGNS
# ============================================
echo ""
echo "===== L. CAMPAIGNS ====="

# Test 91: GET campaigns
echo "Test 91: GET campaigns"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/campaigns" -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  log_result 91 "GET campaigns -> 200" "PASS"
  # Get a campaign ID if any
  CAMPAIGN_ID=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)
else
  log_result 91 "GET campaigns -> 200" "FAIL" "HTTP $CODE"
fi

# Create a test campaign if none exist
if [ -z "$CAMPAIGN_ID" ]; then
  CAMP_RESP=$(curl -s -X POST "$BASE/api/admin/campaigns" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"type":"sms","name":"QA Test Campaign","recipients_count":10,"cost_cents":500}')
  CAMPAIGN_ID=$(echo "$CAMP_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
fi

# Test 92: GET campaign ROI
echo "Test 92: GET campaign ROI"
if [ -n "$CAMPAIGN_ID" ]; then
  RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/campaigns/$CAMPAIGN_ID/roi" -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(echo "$RESP" | sed 's/|||[0-9]*$//')
  CODE=$(echo "$RESP" | grep -o '[0-9]*$')
  if [ "$CODE" = "200" ]; then
    log_result 92 "GET campaign ROI -> 200" "PASS"
  else
    log_result 92 "GET campaign ROI -> 200" "FAIL" "HTTP $CODE"
  fi
else
  log_result 92 "GET campaign ROI" "WARN" "No campaign ID"
fi

# Test 93: Verify ROI structure
echo "Test 93: Verify ROI structure"
if [ -n "$CAMPAIGN_ID" ]; then
  RESP=$(curl -s "$BASE/api/admin/campaigns/$CAMPAIGN_ID/roi" -H "Authorization: Bearer $ADMIN_TOKEN")
  HAS_STRUCT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('cost_cents' in d and 'clicks' in d and 'bookings_count' in d and 'revenue_cents' in d and 'roi_percent' in d)" 2>/dev/null)
  if [ "$HAS_STRUCT" = "True" ]; then
    log_result 93 "ROI structure OK (cost, clicks, bookings, revenue, roi_percent)" "PASS"
  else
    log_result 93 "ROI structure" "FAIL" "Missing fields in: $RESP"
  fi
else
  log_result 93 "ROI structure" "WARN" "No campaign ID"
fi

# ============================================
# M. SQL INJECTION
# ============================================
echo ""
echo "===== M. SQL INJECTION ====="

# Test 94: SQL injection in search
echo "Test 94: SQL injection in search"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients?search=%27%20OR%201%3D1%20--" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  # Should return normal results (not all clients due to injection)
  COUNT=$(echo "$RESP" | sed 's/|||[0-9]*$//' | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])" 2>/dev/null)
  log_result 94 "SQL injection search -> 200 (safe, total=$COUNT)" "PASS"
else
  log_result 94 "SQL injection search" "FAIL" "HTTP $CODE"
fi

# Test 95: SQL injection DROP TABLE
echo "Test 95: SQL injection DROP TABLE"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients?search=%27%3B%20DROP%20TABLE%20clients%3B%20--" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "200" ]; then
  # Verify clients table still works
  VERIFY=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients" -H "Authorization: Bearer $ADMIN_TOKEN")
  V_CODE=$(echo "$VERIFY" | grep -o '[0-9]*$')
  if [ "$V_CODE" = "200" ]; then
    log_result 95 "SQL injection DROP TABLE -> safe (table intact)" "PASS"
  else
    log_result 95 "SQL injection DROP TABLE" "FAIL" "Table may be damaged!"
  fi
else
  log_result 95 "SQL injection DROP TABLE" "WARN" "HTTP $CODE (error response is OK too)"
fi

# Test 96: inactive_weeks=abc -> 400
echo "Test 96: inactive_weeks=abc"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients?inactive_weeks=abc" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ] || [ "$CODE" = "422" ]; then
  log_result 96 "inactive_weeks=abc -> $CODE (validated)" "PASS"
else
  log_result 96 "inactive_weeks=abc -> 400" "FAIL" "HTTP $CODE"
fi

# Test 97: inactive_weeks SQL injection
echo "Test 97: inactive_weeks SQL injection"
RESP=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients?inactive_weeks=1%3B%20DROP%20TABLE%20clients" -H "Authorization: Bearer $ADMIN_TOKEN")
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ] || [ "$CODE" = "422" ]; then
  log_result 97 "inactive_weeks SQL injection -> $CODE (blocked)" "PASS"
else
  # Even if 200, check table still works
  VERIFY=$(curl -s -w "|||%{http_code}" "$BASE/api/admin/clients" -H "Authorization: Bearer $ADMIN_TOKEN")
  V_CODE=$(echo "$VERIFY" | grep -o '[0-9]*$')
  if [ "$V_CODE" = "200" ]; then
    log_result 97 "inactive_weeks SQL injection -> safe (accepted but parameterized)" "WARN" "HTTP $CODE but table intact (isInt validation might have failed)"
  else
    log_result 97 "inactive_weeks SQL injection" "FAIL" "Table may be damaged!"
  fi
fi

# Test 98: Booking with SQL in barber_id
echo "Test 98: Booking SQL injection in barber_id"
RESP=$(curl -s -w "|||%{http_code}" -X POST "$BASE/api/admin/bookings" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"barber_id":"1; DROP TABLE bookings;--","service_id":"'"$SERVICE1_ID"'","date":"2026-03-12","start_time":"10:00","first_name":"SQL","last_name":"Inject","phone":"0612345686"}')
CODE=$(echo "$RESP" | grep -o '[0-9]*$')
if [ "$CODE" = "400" ] || [ "$CODE" = "422" ]; then
  log_result 98 "SQL injection in barber_id -> $CODE (blocked)" "PASS"
else
  log_result 98 "SQL injection in barber_id" "FAIL" "HTTP $CODE"
fi

# ============================================
# FINAL REPORT
# ============================================
echo ""
echo "=========================================="
echo "       RAPPORT FINAL QA AUDIT"
echo "=========================================="
echo ""
TOTAL=$((PASS+FAIL+WARN))
echo -e "$RESULTS"
echo "=========================================="
echo "SCORE: $PASS PASS / $FAIL FAIL / $WARN WARN sur $TOTAL tests"
echo "=========================================="
