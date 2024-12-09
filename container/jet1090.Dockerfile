FROM ubuntu:20.04

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils libsoapysdr-dev && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash user
USER user
RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/xoolive/rs1090/releases/download/v0.3.8/jet1090-installer.sh | sh
# the binary is not installed at ~/.cargo/bin/jet1090

CMD /home/user/.cargo/bin/jet1090 --help
