import time
from flask import Flask, jsonify, render_template
from ADSBC_live import ADSBClient, nb_vol, main
from ipywidgets import HTML
from ipyleaflet import Map, Marker, Icon, Polygon
app = Flask(__name__)


def calcul_list_vols() -> dict:
    return nb_vol(app.client)


@app.route('/api/radarcape/', methods=['GET'])
def list_vols():
    xa = time.time()
    print(app.client.queue.qsize())
    resultats = calcul_list_vols()
    print(time.time()-xa)
    return jsonify(resultats)


@app.route('/api/radarcape/map', methods=['GET'])
def create_map():
    resultats = calcul_list_vols()
    center = (43.57153, 1.4752)
    # icon=Icon(icon_url="https://cdn4.iconfinder.com/data/icons/ionicons/512/icon-plane-512.png")
    map = Map(center=center, zoom=5, close_popup_on_click=True)
    for m in resultats:
        marker = Marker(location=resultats[m][0]["ps"])
        map.add_layer(marker)
        message2 = HTML()
        message2.value = str(resultats[m][0]["ps"])
        marker.popup = message2
    map.save('template/my_map.html', title='My Map')
    #return render_template("my_map.html")


if __name__ == "__main__":
    app.client = ADSBClient(host='134.212.189.239',
                            port=10005, rawtype='beast')
    main(app.client)
    app.run(debug=True)
