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
  return `<tr id="data-${data.icao24}" class="flight-row">${createInnerHTML(data)}</tr>`;
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function handleRowHover(tr) {
  const icao24 = tr.id.replace('data-', '');
  const flightData = flightStore.get(icao24);
  if (flightData) {
    console.log('Flight data:', flightData);
    const event = new CustomEvent('flightHover', {
      detail: {
        flightData,
        element: tr
      }
    });
    document.dispatchEvent(event);
  }
}

function setupHoverListeners() {
  const tbody = document.getElementById('flight-data-body');
  let currentHoveredRow = null;

  const debouncedHoverHandler = debounce((tr) => {
    handleRowHover(tr);
  }, 100);

  tbody.addEventListener('mouseover', (event) => {
    const tr = event.target.closest('tr');
    if (tr && tr !== currentHoveredRow) {
      currentHoveredRow = tr;
      tr.classList.add('table-active');  // add hover style
      debouncedHoverHandler(tr);
    }
  });

  tbody.addEventListener('mouseout', (event) => {
    const tr = event.target.closest('tr');
    if (tr) {
      tr.classList.remove('table-active');
      currentHoveredRow = null;
    }
  });
}

function updateTableRow(data) {
  const rowId = `data-${data.icao24}`;
  const tbody = document.getElementById('flight-data-body');
  const existingRow = document.getElementById(rowId);

  if (existingRow) {
    const rowElement = document.createElement('tr');
    rowElement.id = rowId;
    rowElement.className = 'flight-row';
    rowElement.innerHTML = createInnerHTML(data);
    morphdom(existingRow, rowElement);
  } else {
    tbody.insertAdjacentHTML('beforeend', createRowHtml(data));
  }
}

function cleanupOldEntries(currentTimestamp) {
  const TIMEOUT_THRESHOLD = 60;

  flightStore.forEach((data, icao24) => {
    if (currentTimestamp - data.timestamp > TIMEOUT_THRESHOLD) {
      flightStore.delete(icao24);
      const row = document.getElementById(`data-${icao24}`);
      if (row) {
        row.remove();
      }
      console.log(`el ${icao24} removed.`);
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
  // const userToken = "joining-token";

  // const url = "";
  const url = "ws://192.168.11.34:5000";
  let resp = {
    "channel": "table",
    "id": "random",
    "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZCI6InJhbmRvbSIsImNoYW5uZWwiOiJ0YWJsZSIsImV4cCI6MTczNjQxMTAwNH0.Jdk3hRffB285HeHIwRQyeC0K17djcg9nOdGcxeCJC-g"
  };
  let socket = new Socket(url, { debug, params: { userToken: resp.token } });
  socket.connect();

  // const channelName = 'channel:table';
  // const channelToken = "channel-token";
  const channelName = "table";
  const channelToken = resp.token;

  let tableChannel = socket.channel(channelName, { token: channelToken });
  tableChannel.on('update-row', updateEl);
  tableChannel
    .join()
    .receive("ok", ({ messages }) => {
      console.log(`Connected to ${channelName}`, messages);
    })
    .receive("error", ({ reason }) => {
      console.error(`Failed to join ${channelName}:`, reason);
    })
    .receive("timeout", () => {
      console.warn(`Connection timeout for ${channelName}`);
    });

  setupHoverListeners();

  document.addEventListener('flightHover', (event) => {
    const { flightData } = event.detail;
    console.log(`Hovering over flight ${flightData.icao24}`);

    // docs: https://hexdocs.pm/phoenix/js/index.html#channel
    // broadcast, don't care about thre result
    tableChannel.push("event:flight-hover", { icao24: flightData.icao24 })
    // .receive("ok", payload => console.log("hover push, replied:", payload))
    // .receive("error", err => console.log("hover push, errored", err))
    // .receive("timeout", () => console.log("hover push, timed out"))
    //
    // to capture the event from server side
    // fow now, it timeouts
    // iredis --url redis://redis:6379 subscribe channel:table:event:flight-hover
  });
});
