#!/bin/bash
# Deploy site vitrine sur Cloudflare Pages
# IMPORTANT: exclut backend/, .claude/, .env et tout fichier sensible

set -e

DEPLOY_DIR=$(mktemp -d)
trap "rm -rf $DEPLOY_DIR" EXIT

echo "📦 Copie des fichiers site (sans backend ni secrets)..."
rsync -a \
  --exclude='backend' \
  --exclude='.claude' \
  --exclude='CLAUDE.md' \
  --exclude='.git' \
  --exclude='.env*' \
  --exclude='node_modules' \
  --exclude='dashboard' \
  --exclude='tests' \
  --exclude='playwright.config.js' \
  --exclude='deploy-site.sh' \
  . "$DEPLOY_DIR/"

# Fichier bloquant au cas où quelqu'un restaure un ancien deploy
mkdir -p "$DEPLOY_DIR/backend"
echo "# blocked" > "$DEPLOY_DIR/backend/.env"

echo "🚀 Déploiement sur Cloudflare Pages..."
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?'CLOUDFLARE_API_TOKEN non défini. Exporter la variable avant de lancer le script.'}" \
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?'CLOUDFLARE_ACCOUNT_ID non défini.'}" \
npx wrangler pages deploy "$DEPLOY_DIR" \
  --project-name barberclub-site \
  --branch production \
  --commit-dirty=true

echo "✅ Déployé ! Vérification .env bloqué..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://barberclub-site.pages.dev/backend/.env")
if [ "$STATUS" = "200" ]; then
  CONTENT=$(curl -s "https://barberclub-site.pages.dev/backend/.env" | head -1)
  if [ "$CONTENT" = "# blocked" ]; then
    echo "✅ .env bloqué (contenu remplacé)"
  else
    echo "⚠️  ATTENTION: .env toujours accessible avec du vrai contenu !"
  fi
else
  echo "✅ .env retourne $STATUS"
fi
