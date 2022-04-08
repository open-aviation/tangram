from dump import TestClient
import time

client = TestClient.start_live(
    host="134.212.189.239", port=10005, reference="LFBO"
)

while True:
    time.sleep(60)
    pass
