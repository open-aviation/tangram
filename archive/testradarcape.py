from flask import Flask, jsonify
import csv
from collections import defaultdict

app = Flask(__name__)
@app.route('/api/radarcape/')
def vols():
    data=defaultdict(lambda: [])

    with open('sil/data/RAW_20210924_09_decoded.csv', newline='') as csvfile:
        reader = csv.reader(csvfile, delimiter=' ', quotechar='|')
        for row in reader:
            id=row[0].split(',')[1]
            data[id].append(row)

    resultats={}
    for id in data.keys():
        d=[x for x in data[id]]
        resultats[id]=min(d)

    return jsonify(resultats)

if __name__ == "__main__":
    app.run(debug=True)
    