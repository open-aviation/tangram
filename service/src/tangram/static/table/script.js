const flightStore = new Map();

function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toISOString();
}

function formatCoordinate(coord) {
  return parseFloat(coord).toFixed(4);
}

function formatAltitude(altitude) {
  return `${Math.round(altitude)}m`;
}

function createInnerHTML(data) {
  return `
    <td class="seq">${data.seq}</td>
    <td class="icao24">${data.icao24}</td>
    <td class="timestamp">${formatTimestamp(data.timestamp)}</td>
    <td class="latitude">${formatCoordinate(data.latitude)}</td>
    <td class="longitude">${formatCoordinate(data.longitude)}</td>
    <td class="altitude">${formatAltitude(data.altitude)}</td>
  `;
}

function createRowHtml(data) {
  return `<tr id="data-${data.icao24}">${createInnerHTML(data)}</tr>`;
}

function updateTableRow(data) {
  const rowId = `data-${data.icao24}`;
  const tbody = document.getElementById('flight-data-body');
  const existingRow = document.getElementById(rowId);

  if (existingRow) {
    const rowElement = document.createElement('tr');
    rowElement.id = rowId;
    rowElement.innerHTML = createInnerHTML(data);
    morphdom(existingRow, rowElement); // replace
  } else {
    tbody.insertAdjacentHTML('beforeend', createRowHtml(data));
  }
}

function cleanupOldEntries(currentTimestamp) {
  const TIMEOUT_THRESHOLD = 60; // Remove entries older than 60 seconds

  flightStore.forEach((data, icao24) => {
    if (currentTimestamp - data.timestamp > TIMEOUT_THRESHOLD) {
      flightStore.delete(icao24);
      const row = document.getElementById(`data-${icao24}`);
      if (row) {
        row.remove();
      }
      console.log(`el ${icao24} removed.`)
    }
  });
}

function updateEl(data) {
  try {
    flightStore.set(data.icao24, data);

    const total = flightStore.size;
    document.getElementById('total-flights').textContent = total;

    updateTableRow(data);
    cleanupOldEntries(data.timestamp);
  } catch (error) {
    console.error('Error processing update:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const { Socket } = Phoenix;
  const debug = false;
  const userToken = "joining-token";

  let socket = new Socket("", { debug, params: { userToken } });
  socket.connect();

  const systemChannelName = "channel:table";
  const systemChannelToken = "channel-token";
  let tableChannel = socket.channel(systemChannelName, { token: systemChannelToken });

  tableChannel.on('update-row', updateEl);

  tableChannel
    .join()
    .receive("ok", ({ messages }) => {
      console.log(`Connected to ${systemChannelName}`, messages);
    })
    .receive("error", ({ reason }) => {
      console.error(`Failed to join ${systemChannelName}:`, reason);
    })
    .receive("timeout", () => {
      console.warn(`Connection timeout for ${systemChannelName}`);
    });

  socket.onClose(() => {
    console.log("Socket connection closed");
    // Attempt to reconnect after 5 seconds
    setTimeout(() => {
      console.log("Attempting to reconnect...");
      socket.connect();
    }, 5000);
  });
});

