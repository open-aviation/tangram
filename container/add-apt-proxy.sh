#!/usr/bin/env bash

replace_local_proxy() {
  # url="http://localhost:8080"
  # new_url=$(replace_local_proxy "$url")
  # echo "resulting updated proxy url: $new_url"

  local input="$1"
  local output

  if [ -z "$input" ]; then
    return 1
  fi

  if echo "$input" | grep -qE '(localhost|127\.0\.0\.1)'; then
      output=$(echo "$input" | sed -E 's/(localhost|127\.0\.0\.1)/host.containers.internal/g')
      echo "detect local proxy configuration, replaced: ${input} => ${output}" >&2
      echo "$output"
      return 0
  else
      # 不需要替换，直接返回原始输入
      echo "$input"
      return 0
  fi
}

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

# if it's localhost or 127.0.0.1, replace it with host.containers.internal
http_proxy_value=$(replace_local_proxy $http_proxy_value)
https_proxy_value=$(replace_local_proxy $https_proxy_value)

mkdir -p /etc/apt/apt.conf.d
PROXY_CONF="/etc/apt/apt.conf.d/99-proxy.conf"
cat >"$PROXY_CONF" <<EOF
Acquire::http::Proxy "$http_proxy_value";
Acquire::https::Proxy "$https_proxy_value";
EOF

echo "APT proxy settings have been updated in $PROXY_CONF"
cat $PROXY_CONF
