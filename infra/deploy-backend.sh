#!/bin/bash
# RapidCanvas Backend Deploy Script (FastAPI)
set +e

echo "=========================================="
echo "RapidCanvas Backend Deploy Script"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

TARGET_ENV="${1:-}"
if [ "$TARGET_ENV" != "prod" ] && [ "$TARGET_ENV" != "dev" ]; then
  echo "Usage: $0 <prod|dev>"
  echo "  prod → infra/.rapidcanvas       + app/.env.prod bundled as .env"
  echo "  dev  → infra/.rapidcanvas.dev   + app/.env.dev  bundled as .env"
  exit 1
fi
if [ "$TARGET_ENV" = "prod" ]; then
  CONFIG_FILE="$SCRIPT_DIR/.rapidcanvas"
  ENV_SOURCE="app/.env.prod"
else
  CONFIG_FILE="$SCRIPT_DIR/.rapidcanvas.dev"
  ENV_SOURCE="app/.env.dev"
fi
echo "[INFO] Target: $TARGET_ENV | config=$CONFIG_FILE | env=$ENV_SOURCE"

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
if [ ! -f "$ENV_SOURCE" ]; then
  echo "[ERROR] env file not found at $ENV_SOURCE"; exit 1
fi

FASTAPI_ID=$(grep "^FASTAPI_ID=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d ' ')
BACKEND_PATH=$(grep "^backendPath=" "$CONFIG_FILE" | cut -d'=' -f2 | tr -d ' ')
BACKEND_PATH="${BACKEND_PATH:-backend}"
API_HOST=$(grep "^API_HOST=" "$CONFIG_FILE" | cut -d'=' -f2- | tr -d ' ')
API_HOST="${API_HOST:-https://app.rapidcanvas.ai}"

echo "[DEBUG] FastAPI ID: $FASTAPI_ID"
echo "[DEBUG] Backend Path: $BACKEND_PATH"
echo "[DEBUG] API Host: $API_HOST"

if [ -z "$FASTAPI_ID" ]; then echo "[ERROR] FASTAPI_ID not configured"; exit 1; fi
if [ ! -d "$BACKEND_PATH" ]; then echo "[ERROR] Backend path '$BACKEND_PATH' does not exist"; exit 1; fi

if [ -z "$RAPIDCANVAS_API_KEY" ]; then
  echo "[ERROR] RAPIDCANVAS_API_KEY not set"; exit 1
fi

echo ""
echo "=========================================="
echo "Step 1: Get Bearer token"
echo "=========================================="

TOKEN_RESPONSE=$(curl_with_retry "$API_HOST/api/access_key/token" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Accept: application/json")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to get Bearer token"; exit 1; fi
TOKEN_BODY=$(echo "$TOKEN_RESPONSE" | grep -v "\[HTTP_STATUS\]")
BEARER_TOKEN=$(echo "$TOKEN_BODY" | jq -r '.token // .access_token // .' 2>/dev/null)
if [ -z "$BEARER_TOKEN" ] || [ "$BEARER_TOKEN" == "null" ]; then
  BEARER_TOKEN=$(echo "$TOKEN_BODY" | tr -d '"')
fi
echo "[DEBUG] Bearer token obtained"

echo ""
echo "=========================================="
echo "Step 2: Get FastAPI app details"
echo "=========================================="

FASTAPI_RESPONSE=$(curl_with_retry "$API_HOST/api/fastapi?id=$FASTAPI_ID" \
  -H "Authorization: Bearer $BEARER_TOKEN" -H "Accept: application/json")
if [ $? -ne 0 ]; then echo "[ERROR] Failed to get FastAPI details"; exit 1; fi
FASTAPI_BODY=$(echo "$FASTAPI_RESPONSE" | grep -v "\[HTTP_STATUS\]")

APP_NAME=$(echo "$FASTAPI_BODY" | jq -r '.[0].name' 2>/dev/null)
PROJECT_ID=$(echo "$FASTAPI_BODY" | jq -r '.[0].projectId' 2>/dev/null)
echo "[DEBUG] App Name: $APP_NAME"
echo "[DEBUG] Project ID: $PROJECT_ID"

ZIP_NAME="${APP_NAME}.zip"

echo ""
echo "=========================================="
echo "Step 3: Creating zip file"
echo "=========================================="

rm -f "$ZIP_NAME"

# Stage files in a temp dir so ENV_SOURCE (.env.prod / .env.dev) is bundled
# under the name ".env" without modifying the source files.
STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT

if [ ! -f "$BACKEND_PATH/main.py" ]; then
  echo "[ERROR] main.py not found in $BACKEND_PATH"; exit 1
fi
cp "$BACKEND_PATH/main.py" "$STAGE_DIR/main.py"

if [ -f "$BACKEND_PATH/requirements.txt" ]; then
  cp "$BACKEND_PATH/requirements.txt" "$STAGE_DIR/requirements.txt"
elif [ -f "requirements.txt" ]; then
  cp "requirements.txt" "$STAGE_DIR/requirements.txt"
else
  echo "[ERROR] requirements.txt not found"; exit 1
fi

cp "$ENV_SOURCE" "$STAGE_DIR/.env"
echo "[INFO] Bundled $ENV_SOURCE as .env (target: $TARGET_ENV)"

(cd "$STAGE_DIR" && zip -q "$PROJECT_ROOT/$ZIP_NAME" main.py requirements.txt .env)

ZIP_SIZE=$(ls -lh "$ZIP_NAME" | awk '{print $5}')
echo "[DEBUG] Zip created: $ZIP_NAME ($ZIP_SIZE)"

echo ""
echo "=========================================="
echo "Step 4: Generating signed URL"
echo "=========================================="

RESPONSE=$(curl_with_retry "$API_HOST/api/signed-url/generate-file-upload-url" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Content-Type: application/json" --max-time 60 \
  -d "{\"fileName\":\"$ZIP_NAME\",\"signedUrlObjectType\":\"FASTAPI_APP\",\"metadata\":{\"projectId\":\"$PROJECT_ID\",\"fastApiAppId\":\"$FASTAPI_ID\"}}")
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
echo "Step 5: Uploading zip"
echo "=========================================="

UPLOAD_RESPONSE=$(curl_with_retry -X PUT "$SIGNED_URL" \
  -H "Content-Type: application/octet-stream" --data-binary "@$ZIP_NAME" --max-time 180)
if [ $? -ne 0 ]; then echo "[ERROR] Upload failed"; rm -f "$ZIP_NAME"; exit 1; fi
echo "[SUCCESS] Zip uploaded"
rm -f "$ZIP_NAME"

echo ""
echo "=========================================="
echo "Step 6: Launch FastAPI app"
echo "=========================================="

LAUNCH_RESPONSE=$(curl_with_retry -X POST "$API_HOST/api/fastapi/$FASTAPI_ID/launch" \
  -H "X-API-KEY: $RAPIDCANVAS_API_KEY" -H "Accept: application/json" -H "Content-Length: 0")
if [ $? -ne 0 ]; then echo "[ERROR] Launch failed"; exit 1; fi
echo "[SUCCESS] App launched"

echo ""
echo "=========================================="
echo "[SUCCESS] Backend Deploy complete!"
echo "App: $APP_NAME | FastAPI ID: $FASTAPI_ID"
echo "=========================================="
