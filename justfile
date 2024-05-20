set dotenv-load := true


remove-image cli:
  {{cli}} image rm -f tangram:0.1


build-image cli:
  {{cli}} build -t tangram:0.1 .


run cli: (build-image cli)
  {{cli}} run -it --rm --name tg -p 18000:18000 -e RS1090_SOURCE_BASE_URL=http://51.158.72.24:8080 tangram:0.1


# TODO choose between -v & -e for source configuration
run-dev cli:
  @{{cli}} run -it --rm --name tg-dev -p 18000:18000 \
    -v ./src:/home/user/tangram/src \
    -v ./.env:/home/user/tangram/.env \
    tangram:0.1 \
    poetry run -- uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config=log.yml --reload

tail-rs1090 cli:
  @{{cli}} container exec -it tg-dev tail -f /tmp/tg-rs1090.log

dev-repl cli:
  {{cli}} container exec -it tg-dev /bin/bash


# TODO make it easier for local venv development
