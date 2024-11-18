#!/usr/bin/env bash
set -x -euo pipefail

# Get HTTP proxy, fallback to HTTPS proxy if not set
# http_proxy_value=${http_proxy:-$https_proxy}
http_proxy_value="http://192.168.11.1:1081"

# Get HTTPS proxy, fallback to HTTP proxy if not set
# https_proxy_value=${https_proxy:-$http_proxy}
https_proxy_value="http://192.168.11.1:1081"

# If either proxy is set, add to apt.conf
if [ -n "$http_proxy_value" ] || [ -n "$https_proxy_value" ]; then
        echo "Configuring proxy settings..."

        [ -n "$http_proxy_value" ] && echo "Acquire::http::Proxy \"$http_proxy_value\";" >>/etc/apt/apt.conf
        [ -n "$https_proxy_value" ] && echo "Acquire::https::Proxy \"$https_proxy_value\";" >>/etc/apt/apt.conf

        echo "Proxy settings added to /etc/apt/apt.conf"
else
        echo "No proxy environment variables found. Skipping proxy configuration."
fi
