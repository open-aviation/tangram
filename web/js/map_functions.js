

// let prior_selected = null;
// var selected = null;

const selected_handler = {
  get(target, prop, receiver) {
    if (prop === 'icao24') {
      // console.log('access selected.icao24', target[prop]);
      return target[prop];
    }
    return Reflect.get(target, prop, receiver); // fallback
  },
  set(target, prop, value, _receiver) {
    if (prop === 'icao24') {
      let prior_value = target[prop];
      target['prior_icao24'] = prior_value;
      target['icao24'] = value;
      console.log(`selected icao24 updated, ${prior_value} => ${value}`);
      // prompt to channel event handler
      if (value !== null) {
        // publishEvent(streamingChannel, "select", { icao24: value });
        newChannelEventPush(streamingChannel, "select", { icao24: value })
          .receive("ok", (resp) => {
            trajectoryPlots = [];
            console.log(`(${streamingChannel.topic}) select => `, resp);
          })
        return true;
      }
    }
  }
}

var selected = new Proxy({ icao24: null, prior_icao24: null }, selected_handler);

let trajectoryPlots = []; // array of (latitude, longitude)
// channel name: channel:trajectory:${icao24}
let trajectoryChannel = null;
let trajectoryPloyline = null;

function getFlightMeta(icao24, callsign, tail, typecode) {
  document.getElementById("icao24").innerHTML = icao24;
  document.getElementById("typecode").innerHTML = typecode;
  document.getElementById("tail").innerHTML = tail;
  document.getElementById("aircraft_id").innerHTML = callsign;

  // url = "context/flight/" + icao24;
  // $.getJSON(url, function (data) {
  //   flight_id = document.getElementById("flight_id");
  //   departure = document.getElementById("departure");
  //   destination = document.getElementById("destination");
  //
  //   if (data.flightId === undefined) {
  //     flight_id.innerHTML = "";
  //     departure.innerHTML = "";
  //     destination.innerHTML = "";
  //   } else {
  //     flight_id.innerHTML = data.flightId.id;
  //     departure.innerHTML = data.flightId.keys.aerodromeOfDeparture;
  //     destination.innerHTML = data.flightId.keys.aerodromeOfDestination;
  //     aircraft_id.innerHTML = data.flightId.keys.aircraftId;
  //   }
  // });

  document.getElementById("flight").hidden = false;
}
