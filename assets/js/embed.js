/*

  Embed gamma spectrum using Plotly JS.
  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  Parameter:
    - JSON Object for SpectrumData
    - Unit for x- and y-axes


*/

const SpectrumData = function() { // Will hold the measurement data globally.
  this.data = [];
  this.background = [];
};

let spectrumData = new SpectrumData();
let plot = new SpectrumPlot('plot');

document.body.onload = function() {
  const domain = new URL(window.location.href);
  console.log(domain);
  var params = new URLSearchParams(domain.search);
  //console.log(JSON.parse(params.get('data')));
  //console.log(JSON.parse(params.get('layout')));

  plot.resetPlot(spectrumData);

  const loadingSpinner = document.getElementById('js-error');
  loadingSpinner.parentNode.removeChild(loadingSpinner); // Delete Loading Thingymajig
}

// Needed For Responsiveness! DO NOT REMOVE OR THE LAYOUT GOES TO SHIT!!!
document.body.onresize = function() {
  plot.updatePlot(spectrumData);
};
