#!/usr/bin/env bash

set -euo pipefail
[ "${TRACE:-0}" = "1" ] && set -x

[ "$(id -u)" -ne 0 ] && echo "This script must be run as root" >&2 && exit 1

# Get proxy values with fallbacks: lower case > upper case > the other protocol > empty string
http_proxy_value=${http_proxy:-${HTTP_PROXY:-${https_proxy:-${HTTPS_PROXY:-""}}}}
https_proxy_value=${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-""}}}}

[ -z "$http_proxy_value" ] && [ -z "$https_proxy_value" ] && {
        echo "No proxy environment variables found."
        exit 0
}

mkdir -p /etc/apt/apt.conf.d
PROXY_CONF="/etc/apt/apt.conf.d/99-proxy.conf"
cat >"$PROXY_CONF" <<EOF
Acquire::http::Proxy "$http_proxy_value";
Acquire::https::Proxy "$https_proxy_value";
EOF

echo "APT proxy settings have been updated in $PROXY_CONF"
cat $PROXY_CONF
