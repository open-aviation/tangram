function leaveTrajectoryChannel(channelName) {
  console.log(`leaving trajectory channel ${channelName}`);
  trajectoryChannel
    .leave() // Push
    .receive('ok', () => {
      trajectoryChannel = null;
      console.log(`left channel ${channelName}`, trajectoryChannel);
    })
}
function joinTrajectoryChannel(channelName) {
  console.log(`joining trajectory channel ${channelName}`);

  trajectoryChannel = socket.channel(channelName, { token: 'okToJoin' }); // no joining token required

  trajectoryChannel.on('new-data', (data) => {
    traj.clearLayers();
    // let plots = data.map(({ latitude, longitude }) => [latitude, longitude]);
    // const { latitude, longitude } = data;
    // trajectoryPlots.push([latitude, longitude]);

    console.log(`${trajectoryChannel.topic}`, data.length);
    // trajectoryPlots = data.map(({ latitude, longitude }) => [latitude, longitude]);
    trajectoryPlots = data;
    // console.log(`trajectoryPlots`, trajectoryPlots.length);

    L
      .polyline(trajectoryPlots, { color: 'black', weight: 1, smoothFactor: 2 })
      .addTo(traj);
  });

  trajectoryChannel
    .join()
    .receive("ok", ({ messages }) => {
      trajectoryPlots = [];
      console.log(`(${channelName}) joined`, messages);
    })
    .receive("error", ({ reason }) =>
      console.log(`failed to join ${channelName}`, reason)
    )
    .receive("timeout", () => console.log(`timeout joining ${channelName}`));
}

/// get trajectory data and draw on the map
function getAndDrawTrajectory(icao, und = "", history = 0) {
  const params = new URLSearchParams({ history, und });
  let url = `plugins/trajectory/icao24 / ${icao} ? ${params}`;
  // url = url + "?" + searchParams;
  $.getJSON(url, function (data) {
    traj.clearLayers();
    trajectoryPlots = data.map(({ latitude, longitude }) => [latitude, longitude]);
    // console.log(arr);
    if (trajectoryPlots.length > 0) {
      var polyline = L.polyline(trajectoryPlots, { color: 'black', weight: 1, smoothFactor: 2 }).addTo(traj);
      // zoom in
      // map.fitBounds(polyline.getBounds(), { padding: [400, 0] });
    }
  });
}


