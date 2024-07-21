
function getheatmap(und = null, history = 0) {
  let url = "heatmap.data";
  if (und !== null) {
    url = url + "/" + und;
  }
  if (history) {
    const searchParams = new URLSearchParams({ history: history });
    url = url + "?" + searchParams;
  }
  var heatm;
  $.getJSON(url, function (data) {
    heatm = data.data;
    hexLayer.data(heatm);
  });
  return heatm;
}
