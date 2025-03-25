import logging
import os
import shutil
import sqlite3
import zipfile
from pathlib import Path
from typing import TypedDict

import appdirs
import dotenv
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger(__name__)


def download_file(url: str, destination: Path) -> None:
    response = httpx.get(url)
    response.raise_for_status()
    destination.write_bytes(response.content)


def extract_sqlite_from_zip(zip_path: Path, extract_dir: Path) -> str:
    with zipfile.ZipFile(zip_path, "r") as archive:
        # Assuming the SQLite file is the first entry (adjust if needed)
        sql_filename = archive.namelist()[0]
        destination_path = os.path.join(extract_dir, os.path.basename(sql_filename))
        with archive.open(sql_filename) as src, open(destination_path, "wb") as dst:
            shutil.copyfileobj(src, dst)
    return destination_path


class AircraftDict(TypedDict):
    icao24: str
    registration: str
    typecode: str


def read_aircraft_db(db_path: str) -> dict[str, AircraftDict]:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT ModeS, Registration, ICAOTypeCode FROM Aircraft")

    aircraft_db: dict[str, AircraftDict] = {}
    for row in cursor.fetchall():
        modeS, registration, typecode = row
        key = modeS.lower() if modeS else ""
        aircraft_db[key] = {
            "icao24": key,
            "registration": registration,
            "typecode": typecode,
        }
    conn.close()
    return aircraft_db


def aircraft_db() -> dict[str, AircraftDict]:
    # this helps checking http_proxy in the .env
    dotenv.load_dotenv()

    cache_dir = Path(appdirs.user_cache_dir("jet1090"))
    if not cache_dir.exists():
        cache_dir.mkdir(parents=True)

    if not (zip_file_path := cache_dir / "basestation.zip").exists():
        zip_url = "https://jetvision.de/resources/sqb_databases/basestation.zip"
        log.info("Downloading basestation.zip...")
        download_file(zip_url, zip_file_path)

    log.info("Extracting SQLite database from the ZIP file...")
    sqlite_db_path = extract_sqlite_from_zip(zip_file_path, cache_dir)

    log.info("Reading Aircraft DB...")
    aircraft_data = read_aircraft_db(sqlite_db_path)
    log.info(f"Loaded {len(aircraft_data)} aircraft records")

    return aircraft_data
