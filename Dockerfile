FROM python:3.11-slim as python-poetry-base

# System dependencies
RUN apt-get update\
 && apt-get install -y --no-install-recommends build-essential gcc curl gnupg2 libgeos-dev\
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create a new user, with home directory and shell
RUN useradd -m -s /bin/bash user
USER user
WORKDIR /home/user/

# Install poetry
RUN python -m pip install -U setuptools pip && python -m pip install --user -U poetry
ENV PATH="${PATH}:/home/user/.local/bin"

####
# build image for tangram
FROM python-poetry-base

COPY . /home/user/tangram
WORKDIR /home/user/tangram
RUN poetry install --verbose

# TODO
WORKDIR /home/user/tangram/src/tangram
CMD ["poetry", "run", "--", "uvicorn", "--host", "0.0.0.0", "--port", "18000", "tangram.app:app", "--ws", "websockets", "--log-config=log.yml"]