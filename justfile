set dotenv-load := true


remove-image cli:
  {{cli}} image rm -f tangram:0.1


build-image cli:
  {{cli}} build -t tangram:0.1 .


run cli: (build-image cli)
  {{cli}} run -it --rm --name tg -p 18000:18000 tangram:0.1


run-dev cli:
  @{{container-cli}} run -it --rm --name tg-dev -p 18000:18000 \
    -v ./.env:/home/user/tangram/.env \
    -v ./src:/home/user/tangram/src \
    tangram:0.1 \
  poetry run -- uvicorn --host 0.0.0.0 --port 18000 tangram.app:app --ws websockets --log-config=log.yml --reload
