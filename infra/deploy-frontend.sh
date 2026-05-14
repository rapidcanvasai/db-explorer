#!/bin/bash
# RapidCanvas Frontend Deploy Script
set +e

echo "=========================================="
echo "RapidCanvas Frontend Deploy Script"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-5}"

curl_with_retry() {
  local attempt=1
  local response http_status curl_exit
  while [ $attempt -le $MAX_RETRIES ]; do
    response=$(curl -s -w "\n[HTTP_STATUS]:%{http_code}" "$@" 2>&1)
    curl_exit=$?
    http_status=$(echo "$response" | grep "\[HTTP_STATUS\]" | cut -d':' -f2)
    if [ $curl_exit -eq 0 ] && [[ "$http_status" =~ ^2[0-9][0-9]$ ]]; then
      echo "$response"; return 0
    fi
    if [ $curl_exit -ne 0 ] || [[ "$http_status" =~ ^5[0-9][0-9]$ ]] || [ "$http_status" = "429" ]; then
      echo "[RETRY] Attempt $attempt/$MAX_RETRIES failed (HTTP: $http_status, curl: $curl_exit)" >&2
      if [ $attempt -lt $MAX_RETRIES ]; then sleep $((RETRY_DELAY * attempt)); fi
      ((attempt++))
    else
      echo "$response"; return 1
    fi
  done
  echo "[ERROR] All $MAX_RETRIES attempts failed" >&2
  echo "$response"; return 1
}

TARGET_ENV="${1:-}"
if [ "$TARGET_ENV" != "prod" ] && [ "$TARGET_ENV" != "dev" ]; then
  echo "Usage: $0 <prod|dev>"
  echo "  prod → infra/.rapidcanvas"
  echo "  dev  → infra/.rapidcanvas.dev"
  exit 1
fi
if [ "$TARGET_ENV" = "prod" ]; then
  CONFIG_FILE="$SCRIPT_DIR/.rapidcanvas"
else
  CONFIG_FILE="$SCRIPT_DIR/.rapidcanvas.dev"
fi
echo "[INFO] Target: $TARGET_ENV | config=$CONFIG_FILE"

if [ -f "$PROJECT_ROOT/.env" ]; then
  # Only export vars that aren't already set in the caller's env, so an
  # explicit RAPIDCANVAS_API_KEY=... prefix on the command line wins.
  while IFS='=' read -r k v; do
    [ -z "$k" ] && continue
    [[ "$k" =~ ^# ]] && continue
    if [ -z "${!k}" ]; then export "$k=$v"; fi
  done < <(grep -v '^#' "$PROJECT_ROOT/.env" | grep '=')
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "[ERROR] config not found at $CONFIG_FILE"; exit 1
fi

DATAAPP_ID=$(grep "^DATAAPP_ID=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d ' ')
FASTAPI_ID=$(grep "^FASTAPI_ID=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d ' ')
DASHBOARD_PATH=$(grep "^dashboardPath=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d ' ')
API_PREFIX=$(grep "^API_PREFIX=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d ' ')
API_HOST=$(grep "^API_HOST=" "$CONFIG_FILE" | cut -d'=' -f2- | tr -d ' ')
API_HOST="${API_HOST:-https://app.rapidcanvas.ai}"

echo "[DEBUG] DataApp ID: $DATAAPP_ID"
echo "[DEBUG] FastAPI ID: $FASTAPI_ID"
echo "[DEBUG] Dashboard Path: $DASHBOARD_PATH"
echo "[DEBUG] API Host: $API_HOST"

if [ -z "$DATAAPP_ID" ]; then echo "[ERROR] DATAAPP_ID not configured"; exit 1; fi
if [ -z "$RAPIDCANVAS_API_KEY" ]; then echo "[ERROR] RAPIDCANVAS_API_KEY not set"; exit 1; fi

echo ""
echo "=========================================="
echo "Step 1: Get dataapp details"
echo "=========================================="

DATAAPP_RESPONSE=$(curl_with_retry "$API_HOST/api/dataapps/by-id/$DATAAPP_ID" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Accept: application/json")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to get dataapp details"; exit 1; fi
DATAAPP_BODY=$(echo "$DATAAPP_RESPONSE" | grep -v "\[HTTP_STATUS\]")

APP_TEMPLATE_ID=$(echo "$DATAAPP_BODY" | jq -r '.appTemplateId' 2>/dev/null)
DATAAPP_SLUG=$(echo "$DATAAPP_BODY" | jq -r '.slug' 2>/dev/null)
echo "[DEBUG] App Template ID: $APP_TEMPLATE_ID"
echo "[DEBUG] DataApp Slug: $DATAAPP_SLUG"

echo ""
echo "=========================================="
echo "Step 2: Get FastAPI details (for backend URL)"
echo "=========================================="

if [ -n "$FASTAPI_ID" ]; then
  TOKEN_RESPONSE=$(curl_with_retry "$API_HOST/api/access_key/token" \
    -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Accept: application/json")
  BEARER_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -v "\[HTTP_STATUS\]" | jq -r '.token' 2>/dev/null)

  FASTAPI_RESPONSE=$(curl_with_retry "$API_HOST/api/fastapi?id=$FASTAPI_ID" \
    -H "Authorization: Bearer $BEARER_TOKEN" -H "Accept: application/json")
  FASTAPI_RESPONSE=$(echo "$FASTAPI_RESPONSE" | grep -v "\[HTTP_STATUS\]")

  FASTAPI_PROJECT_ID=$(echo "$FASTAPI_RESPONSE" | jq -r '.[0].projectId' 2>/dev/null)
  FASTAPI_NAME=$(echo "$FASTAPI_RESPONSE" | jq -r '.[0].name' 2>/dev/null)
  echo "[DEBUG] FastAPI Project ID: $FASTAPI_PROJECT_ID"
  echo "[DEBUG] FastAPI Name: $FASTAPI_NAME"

  if [ -n "$FASTAPI_PROJECT_ID" ] && [ "$FASTAPI_PROJECT_ID" != "null" ]; then
    BACKEND_URL="$API_HOST/fastapiapps/$FASTAPI_PROJECT_ID/$FASTAPI_NAME$API_PREFIX"
    echo "[DEBUG] Backend URL: $BACKEND_URL"
  else
    echo "[ERROR] Could not determine FastAPI project ID"; exit 1
  fi
else
  echo "[ERROR] FASTAPI_ID not configured"; exit 1
fi

echo ""
echo "=========================================="
echo "Step 3: Configure frontend environment"
echo "=========================================="

FRONTEND_ENV="$DASHBOARD_PATH/.env"
if [ -n "$BACKEND_URL" ]; then
  touch "$FRONTEND_ENV"
  for VAR_LINE in "VITE_API_URL=$BACKEND_URL" "VITE_BASE_URL=$API_HOST"; do
    VAR_NAME="${VAR_LINE%%=*}"
    if grep -q "^${VAR_NAME}=" "$FRONTEND_ENV"; then
      sed -i.bak "s|^${VAR_NAME}=.*|${VAR_LINE}|" "$FRONTEND_ENV" && rm -f "${FRONTEND_ENV}.bak"
    else
      echo "$VAR_LINE" >> "$FRONTEND_ENV"
    fi
  done
  echo "[INFO] Updated $FRONTEND_ENV:"
  echo "[INFO]   VITE_API_URL=$BACKEND_URL"
  echo "[INFO]   VITE_BASE_URL=$API_HOST"
fi

if [ -n "$DATAAPP_SLUG" ] && [ "$DATAAPP_SLUG" != "null" ]; then
  VITE_CONFIG="$DASHBOARD_PATH/vite.config.ts"
  if [ -f "$VITE_CONFIG" ]; then
    sed -i.bak "s|/dataapps/[^'\"]*|/dataapps/$DATAAPP_SLUG|g" "$VITE_CONFIG"
    rm -f "$VITE_CONFIG.bak"
    echo "[INFO] Updated vite.config.ts base path to /dataapps/$DATAAPP_SLUG"
  fi
fi

echo ""
echo "=========================================="
echo "Step 4: Get app template details"
echo "=========================================="

APP_TEMPLATE_RESPONSE=$(curl_with_retry "$API_HOST/api/app-templates/$APP_TEMPLATE_ID" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Accept: application/json")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to get app template details"; exit 1; fi
APP_TEMPLATE_BODY=$(echo "$APP_TEMPLATE_RESPONSE" | grep -v "\[HTTP_STATUS\]")

APP_NAME=$(echo "$APP_TEMPLATE_BODY" | jq -r '.name' 2>/dev/null)
echo "[DEBUG] App Name: $APP_NAME"
ZIP_NAME="${APP_NAME}.zip"

echo ""
echo "=========================================="
echo "Step 5: Creating zip file"
echo "=========================================="

rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" "$DASHBOARD_PATH" -x "*/.*" -x ".*" -x "$DASHBOARD_PATH/node_modules/*" -x "$DASHBOARD_PATH/dist/*"

if [ -f "$DASHBOARD_PATH/.env" ]; then
  zip -u "$ZIP_NAME" "$DASHBOARD_PATH/.env"
  echo "[DEBUG] Added .env file to zip"
else
  echo "[ERROR] No .env file at $DASHBOARD_PATH/.env"; exit 1
fi

ZIP_SIZE=$(ls -lh "$ZIP_NAME" | awk '{print $5}')
echo "[DEBUG] Zip created: $ZIP_NAME ($ZIP_SIZE)"

echo ""
echo "=========================================="
echo "Step 6: Generating signed URL"
echo "=========================================="

RESPONSE=$(curl_with_retry "$API_HOST/api/signed-url/generate-file-upload-url" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Content-Type: application/json" --max-time 60 \
  -d "{\"fileName\":\"$ZIP_NAME\",\"signedUrlObjectType\":\"APP_TEMPLATE_REACTJS\",\"metadata\":{\"appType\":\"reactjs\",\"SOURCE\":\"TENANT\"}}")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to get signed URL"; rm -f "$ZIP_NAME"; exit 1; fi

RESPONSE_BODY=$(echo "$RESPONSE" | grep -v "\[HTTP_STATUS\]")
INNER_JSON=$(echo "$RESPONSE_BODY" | jq -r '.responseEntity' 2>/dev/null)
if [ -n "$INNER_JSON" ] && [ "$INNER_JSON" != "null" ]; then
  SIGNED_URL=$(echo "$INNER_JSON" | jq -r '.signedUrl' 2>/dev/null)
else
  SIGNED_URL=$(echo "$RESPONSE_BODY" | jq -r '.signedUrl' 2>/dev/null)
fi
if [ "$SIGNED_URL" == "null" ] || [ -z "$SIGNED_URL" ]; then
  echo "[ERROR] Failed to get signed URL"; rm -f "$ZIP_NAME"; exit 1
fi

echo ""
echo "=========================================="
echo "Step 7: Uploading zip"
echo "=========================================="

UPLOAD_RESPONSE=$(curl_with_retry -X PUT "$SIGNED_URL" \
  -H "Content-Type: application/octet-stream" --data-binary "@$ZIP_NAME" --max-time 180)
if [ $? -ne 0 ]; then echo "[ERROR] Upload failed"; rm -f "$ZIP_NAME"; exit 1; fi
echo "[SUCCESS] Zip uploaded"
rm -f "$ZIP_NAME"

echo ""
echo "=========================================="
echo "Step 8: Update app template (trigger rebuild)"
echo "=========================================="

APP_TEMPLATE_PUT_BODY=$(echo "$APP_TEMPLATE_BODY" | jq '.buildStatus = "UNBUILT"')
PUT_TEMPLATE_RESPONSE=$(curl_with_retry -X PUT "$API_HOST/api/app-templates/$APP_TEMPLATE_ID" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Content-Type: application/json" \
  -d "$APP_TEMPLATE_PUT_BODY")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to update app template"; exit 1; fi

echo ""
echo "=========================================="
echo "Step 9: Update dataapp"
echo "=========================================="

PUT_DATAAPP_RESPONSE=$(curl_with_retry -X PUT "$API_HOST/api/dataapps/$DATAAPP_ID" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Content-Type: application/json" \
  -d "$DATAAPP_BODY")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to update dataapp"; exit 1; fi

echo ""
echo "=========================================="
echo "Step 10: Launch dataapp"
echo "=========================================="

LAUNCH_RESPONSE=$(curl_with_retry -X POST "$API_HOST/api/dataapps/$DATAAPP_ID/launch" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Content-Length: 0")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to launch dataapp"; exit 1; fi

echo ""
echo "=========================================="
echo "[SUCCESS] Frontend Deploy complete!"
echo "App: $APP_NAME | DataApp ID: $DATAAPP_ID"
echo "=========================================="
