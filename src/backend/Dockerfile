# Development image for the RakanSpace Laravel API, queue worker, scheduler and Reverb.
FROM php:8.4-cli-alpine

RUN apk add --no-cache icu-dev libzip-dev postgresql-dev linux-headers $PHPIZE_DEPS \
    && docker-php-ext-install -j"$(nproc)" intl pcntl pdo_pgsql zip bcmath sockets \
    && apk del $PHPIZE_DEPS linux-headers \
    && apk add --no-cache icu-libs libzip libpq

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html
EXPOSE 8000 8080
