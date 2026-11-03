#!/bin/sh
# First-run setup for the backend container, then exec the given command.
set -e
cd /var/www/html

if [ ! -f .env ]; then
  cp .env.example .env
fi

if [ ! -f vendor/autoload.php ]; then
  composer install --no-interaction --prefer-dist
fi

if ! grep -q '^APP_KEY=base64:' .env; then
  php artisan key:generate --force
fi

php artisan migrate --force

# Seed demo data once (set SEED_DEMO=false to skip).
if [ "${SEED_DEMO:-true}" = "true" ] && [ ! -f storage/app/.demo-seeded ]; then
  php artisan db:seed --force && touch storage/app/.demo-seeded
fi

exec "$@"
