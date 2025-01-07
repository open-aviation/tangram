FROM ubuntu:24.04

COPY add-apt-proxy.sh /usr/local/bin/add-apt-proxy.sh
RUN add-apt-proxy.sh
RUN apt-get update && apt-get upgrade -y && apt-get install -y curl xz-utils

ARG VERSION

ENV FILE="channel-x86_64-unknown-linux-gnu"
ENV ARCHIVE_URL="https://github.com/emctoo/channel/releases/download/v$VERSION/$FILE.tar.xz"

RUN curl -sL $ARCHIVE_URL -o /tmp/$FILE.tar.xz
RUN tar -xvf /tmp/$FILE.tar.xz -C /tmp
RUN ls -al /tmp/$FILE

RUN mv /tmp/$FILE/channel /usr/local/bin/channel
RUN mkdir -p /var/www/channel && mv /tmp/$FILE/assets /var/www/channel/

USER nobody
WORKDIR /var/www/channel
CMD ["/usr/local/bin/channel", "--help"]
