import time
from flask import Flask, jsonify
from ADSBC_live import ADSBClient, nb_vol, main


app = Flask(__name__)


@app.route('/api/radarcape/')
def vols():
    xa = time.time()
    print(app.client.queue.qsize())
    resultats = nb_vol(app.client)
    print(time.time()-xa)
    return jsonify(resultats)


if __name__ == "__main__":
    app.client = ADSBClient(host='134.212.189.239',
                            port=10005, rawtype='beast')
    main(app.client)
    app.run(debug=True)
