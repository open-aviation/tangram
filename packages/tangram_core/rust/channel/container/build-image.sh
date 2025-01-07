#!/usr/bin/env bash

function is_rootless() {
  [ "$(id -u)" -ne 0 ]
}

if is_rootless; then
  buildah unshare "$0"
  exit
fi

VERSION="0.1.7"
FILE="channel-x86_64-unknown-linux-gnu"
ARCHIVE_URL="https://github.com/emctoo/channel/releases/download/v$VERSION/$FILE.tar.xz"

ctr=$(buildah from ubuntu:24.04)
echo "container: $ctr"

buildah ps -a

mnt=$(buildah mount "$ctr")
echo "mount: ${mnt}"

buildah run "$ctr" cat /etc/os-release

buildah run -v "$PWD/add-apt-proxy.sh:/usr/bin/add-apt-proxy.sh" "$ctr" add-apt-proxy.sh

buildah run "$ctr" /usr/bin/apt update
buildah run "$ctr" /usr/bin/apt install -y curl xz-utils
buildah run "$ctr" /usr/bin/curl -L "$ARCHIVE_URL" -o /tmp/$FILE.tar.xz
buildah run "$ctr" /usr/bin/tar xf /tmp/$FILE.tar.xz -C /tmp

buildah run "$ctr" mkdir -p /var/www/channel
buildah run "$ctr" cp /tmp/$FILE/channel /usr/bin/
buildah run "$ctr" cp -r /tmp/$FILE/assets /var/www/channel/

buildah config --author "Xiaogang <maple.hl@gmail.com>" "$ctr"

buildah config --user nobody "$ctr"
buildah config --workingdir /var/www/channel "$ctr"
buildah config --entrypoint '["/usr/bin/channel"]' "$ctr"
buildah config --cmd '["--help"]'

buildah commit "$ctr" channel:$VERSION

buildah umount "$ctr"
buildah rm "$ctr"
