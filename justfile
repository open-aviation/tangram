set dotenv-load := true

remove-image:
  podman image rm -f tangram:0.1

build-image:
  podman build -t tangram:0.1 .

run: build-image
  podman run -it --rm --name tg -p 18000:18000 localhost/tangram:0.1

run-dev:
  @podman run -it --rm --name tg-dev -p 18000:18000 \
    -v ./.env:/home/user/tangram/.env \
    -v ./src:/home/user/tangram/src \
    localhost/tangram:0.1 \
  poetry run -- uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config=log.yml --reload
