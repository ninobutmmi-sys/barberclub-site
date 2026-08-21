#!/bin/bash
# Deploy site vitrine sur Cloudflare Pages
# IMPORTANT: exclut backend/, .claude/, .env, docs/ (pitch privé), fidelite-club-prive/
# (dossier de transmission à l'équipe app, pas destiné au public), sources/ (masters
# non optimisés, ex. le PNG 5,8 Mo dont sort salon-voiron-nuit.webp) et tout fichier sensible

set -e

DEPLOY_DIR=$(mktemp -d)
trap "rm -rf $DEPLOY_DIR" EXIT

echo "📦 Copie des fichiers site (sans backend ni secrets)..."
rsync -a \
  --exclude='backend' \
  --exclude='.claude' \
  --exclude='.superpowers' \
  --exclude='.wrangler' \
  --exclude='.github' \
  --exclude='CLAUDE.md' \
  --exclude='.git' \
  --exclude='.env*' \
  --exclude='node_modules' \
  --exclude='dashboard' \
  --exclude='tests' \
  --exclude='docs' \
  --exclude='mockups' \
  --exclude='fidelite-club-prive' \
  --exclude='fidelite-club-prive.zip' \
  --exclude='sources' \
  --exclude='.DS_Store' \
  --exclude='playwright.config.js' \
  --exclude='deploy-site.sh' \
  . "$DEPLOY_DIR/"

# Fichier bloquant au cas où quelqu'un restaure un ancien deploy
mkdir -p "$DEPLOY_DIR/backend"
echo "# blocked" > "$DEPLOY_DIR/backend/.env"

echo "🚀 Déploiement sur Cloudflare Pages..."
# Deux modes d'authentification :
#  - CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID exportés (CI, machine sans login) ;
#  - sinon, la session OAuth de `wrangler login` (cas d'une machine de dev déjà
#    connectée). Avant, le script exigeait le token et refusait de tourner alors
#    que wrangler était parfaitement authentifié.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?'CLOUDFLARE_ACCOUNT_ID non défini (requis avec CLOUDFLARE_API_TOKEN).'}" \
  npx wrangler pages deploy "$DEPLOY_DIR" \
    --project-name barberclub-site \
    --branch production \
    --commit-dirty=true
else
  echo "   (pas de CLOUDFLARE_API_TOKEN — utilisation de la session wrangler login)"
  npx wrangler whoami > /dev/null 2>&1 || {
    echo "❌ Ni CLOUDFLARE_API_TOKEN exporté, ni session wrangler. Lance 'npx wrangler login'." >&2
    exit 1
  }
  npx wrangler pages deploy "$DEPLOY_DIR" \
    --project-name barberclub-site \
    --branch production \
    --commit-dirty=true
fi

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
