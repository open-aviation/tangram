use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use std::{collections::HashMap, fmt, path::Path, time::Instant};
use tracing::info;

use crate::state::Aircraft;

const ICAO24_MASK: u32 = 0x00ff_ffff;

/// Validated ICAO 24-bit aircraft address.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Icao24(u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct InvalidIcao24(u32);

impl TryFrom<u32> for Icao24 {
    type Error = InvalidIcao24;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        (value <= ICAO24_MASK)
            .then_some(Self(value))
            .ok_or(InvalidIcao24(value))
    }
}

impl fmt::Display for Icao24 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:06x}", self.0)
    }
}

impl fmt::Display for InvalidIcao24 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "ICAO address exceeds 24 bits: {:#x}", self.0)
    }
}

impl std::error::Error for InvalidIcao24 {}

// TODO consider keeping sqlite open and cache lookups in a bounded LRU to reduce RSS
// holding off now to avoid too much complexity
pub(crate) type AircraftDatabase = HashMap<Icao24, Aircraft>;

pub fn load(path: &Path) -> Result<AircraftDatabase> {
    let started = Instant::now();
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("failed to open aircraft database at {}", path.display()))?;

    let database = load_from_connection(&connection)
        .with_context(|| format!("failed to read aircraft database at {}", path.display()))?;

    info!(
        path = %path.display(),
        aircraft = database.len(),
        elapsed_ms = started.elapsed().as_millis(),
        "loaded aircraft database"
    );

    Ok(database)
}

fn load_from_connection(connection: &Connection) -> Result<AircraftDatabase> {
    let expected_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM Aircraft WHERE ModeS IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .context("failed to count aircraft rows")?;
    let expected_rows =
        usize::try_from(expected_rows).context("aircraft row count does not fit in memory")?;

    let mut database = AircraftDatabase::with_capacity(expected_rows);
    let mut statement = connection
        .prepare(
            "SELECT ModeS, Registration, ICAOTypeCode \
             FROM Aircraft WHERE ModeS IS NOT NULL",
        )
        .context("failed to prepare aircraft query")?;
    let mut rows = statement
        .query([])
        .context("failed to query aircraft rows")?;

    while let Some(row) = rows.next().context("failed to read aircraft row")? {
        let mode_s = row
            .get_ref(0)
            .context("failed to read ModeS value")?
            .as_str()
            .context("ModeS value is not text")?;
        let Some(icao24) = u32::from_str_radix(mode_s.trim(), 16)
            .ok()
            .and_then(|value| Icao24::try_from(value).ok())
        else {
            continue;
        };

        let registration = row
            .get::<_, Option<String>>(1)
            .context("failed to read aircraft registration")?
            .map(String::into_boxed_str);
        let typecode = row
            .get::<_, Option<String>>(2)
            .context("failed to read aircraft typecode")?
            .map(String::into_boxed_str);

        database.insert(
            icao24,
            Aircraft {
                typecode,
                registration,
            },
        );
    }

    Ok(database)
}
