/*

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  ===============================

  Possible Future Improvements:
    - Sorting isotope list
    - Social media share function
    - FWHM calculation for peaks
    - (?) Serial console read capability
    - (?) Hotkey to open/close settings
    - (?) Add desktop notifications
    - Add Isotope Recognition for Peak Detector
    - Spike cursor decimal places
    - (!) Weird comb-structure with quadratic calibrations

  Known Performance Issues:
    - Isotope hightlighting
    - (Un)Selecting all isotopes from gamma-ray energies list (Plotly)
*/

const SpectrumData = function() { // Will hold the measurement data globally.
  this.data = [];
  this.background = [];
  this.dataCps = [];
  this.backgroundCps = [];

  this.getTotalCounts = function(data) {
    let sum = 0;
    data.forEach((item, i) => {
      sum += item;
    });
    return sum;
  };
};

let spectrumData = new SpectrumData();
let plot = new SpectrumPlot('plot');
let raw = new RawData(1); // 2=raw, 1=hist
let ser = new SerialData();

let calClick = { a: false, b: false, c: false };
let oldCalVals = { a: '', b: '', c: ''};
let portsAvail = {};

let serOptions = { baudRate: 9600 }; // Standard baud-rate of 9600 bps
let refreshRate = 1000; // Delay in ms between serial plot updates
let maxRecTimeEnabled = false;
let maxRecTime = 1800000; // 30 mins
const REFRESH_META_TIME = 100; // 100 ms

let cpsValues = [];

let isoListURL = 'assets/isotopes_energies_min.json';
let isoList = {};
let checkNearIso = false;
let maxDist = 100; // Max energy distance to highlight

const APP_VERSION = '2022-05-22a';
let localStorageAvailable = false;
let firstInstall = false;

/*
  Startup of the page
*/
document.body.onload = async function() {
  localStorageAvailable = 'localStorage' in self; // Test for localStorage, for old browsers

  if (localStorageAvailable) {
    loadSettingsStorage();
  }

  if ("serviceWorker" in navigator) { // Add service worker for PWA
    const reg = await navigator.serviceWorker.register("/service-worker.js"); // Onload async because of this... good? hmmm.

    if (localStorageAvailable) {
      reg.addEventListener('updatefound', () => {
          if (firstInstall) { // "Update" will always be installed on first load (service worker installation)
            return;
          }
        popupNotification('update-installed');
      });
    }
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches; // Detect PWA or browser
  if (navigator.standalone || isStandalone) { // Standalone PWA mode
    document.title += ' PWA';
  } else { // Default browser window
    document.getElementById('main').className = document.getElementById('main').className.replaceAll('pb-1', 'p-1');
    document.title += ' web application';
  }

  const domain = new URL(isoListURL, window.location.origin);
  isoListURL = domain.href;

  if ('serial' in navigator) {
    document.getElementById('serial-div').className = ''; // Remove visually-hidden and invisible
    navigator.serial.addEventListener("connect", serialConnect);
    navigator.serial.addEventListener("disconnect", serialDisconnect);
    listSerial(); // List Available Serial Ports
  } else {
    //const serDivElement = document.getElementById('serial-div'); // Delete serial control div
    //serDivElement.parentNode.removeChild(serDivElement);

    const serError = document.getElementById('serial-error');
    serError.className = serError.className.replaceAll(' visually-hidden', '');

    const serSettingsElements = document.getElementsByClassName('ser-settings');
    for (const element of serSettingsElements) { // Disable serial settings
      element.disabled = true;
    }
    const serControlsElements = document.getElementsByClassName('serial-controls');
    for (const element of serControlsElements) { // Disable serial controls
      element.disabled = true;
    }
  }

  plot.resetPlot(spectrumData);
  bindPlotEvents(); // Bind click and hover events provided by plotly

  document.getElementById('version-tag').innerText += ' ' + APP_VERSION + '.';

  if (localStorageAvailable) {
    if (loadJSON('lastVisit') <= 0) {
      popupNotification('welcomeMsg');
      firstInstall = true;
    }
    const time = new Date();
    saveJSON('lastVisit', time.getTime());
    saveJSON('lastUsedVersion', APP_VERSION);

    const settingsNotSaveAlert = document.getElementById('ls-unavailable'); // Remove saving alert
    settingsNotSaveAlert.parentNode.removeChild(settingsNotSaveAlert);
  } else {
    const settingsSaveAlert = document.getElementById('ls-available'); // Remove saving alert
    settingsSaveAlert.parentNode.removeChild(settingsSaveAlert);
    popupNotification('welcomeMsg');
  }

  loadSettingsDefault();
  sizeCheck();

  const loadingSpinner = document.getElementById('loading');
  loadingSpinner.parentNode.removeChild(loadingSpinner); // Delete Loading Thingymajig
};


// Exit website confirmation alert
window.onbeforeunload = function(e) {
  return 'Are you sure to leave?';
};


// Needed For Responsiveness! DO NOT REMOVE OR THE LAYOUT GOES TO SHIT!!!
document.body.onresize = function() {
  plot.updatePlot(spectrumData);
  sizeCheck();
};


// User changed from browser window to PWA (after installation) or backwards
window.matchMedia('(display-mode: standalone)').addEventListener('change', (evt) => {
  /*
  let displayMode = 'browser';
  if (evt.matches) {
    displayMode = 'standalone';
  }
  */
  window.location.reload(); // Just reload the page?
});


let deferredPrompt;

window.onbeforeinstallprompt = function(event) {
  event.preventDefault(); // Prevent the mini-infobar from appearing on mobile
  deferredPrompt = event;

  if (localStorageAvailable) {
    if (!loadJSON('installPrompt')) {
      popupNotification('pwa-installer'); // Show notification on first visit
      saveJSON('installPrompt', true);
    }
  }

  const installButton = document.getElementById('manual-install');
  installButton.className = installButton.className.replaceAll('visually-hidden', '');
};


async function installPWA() {
  //hideNotification('pwa-installer');
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
}


window.onappinstalled = function() {
  deferredPrompt = null;
  hideNotification('pwa-installer');
  document.getElementById('manual-install').className += 'visually-hidden';
};

/*
document.onkeydown = async function(event) {
  console.log(event.keyCode);
  if (event.keyCode === 27) { // ESC
    const offcanvasElement = document.getElementById('offcanvas');
    const offcanvas = new bootstrap.Offcanvas(offcanvasElement);

    //event.preventDefault();

    await offcanvas.toggle();
  }
};
*/

function getFileData(input, background = false) { // Gets called when a file has been selected.
  if (input.files.length == 0) { // File selection has been canceled
    return;
  }
  const file = input.files[0];
  let reader = new FileReader();

  //const fileEnding = file.name.split('.')[1];

  reader.readAsText(file);

  reader.onload = function() {
    const result = reader.result.trim();

    /*
      TODO: FileType über Dateiendung?
    */
    if (background) {
      const bg = raw.csvToArray(result);
      spectrumData.background = bg;
    } else {
      spectrumData.data = raw.csvToArray(result);
    }
    document.getElementById('total-spec-cts').innerText = spectrumData.getTotalCounts(spectrumData.data);
    document.getElementById('total-bg-cts').innerText = spectrumData.getTotalCounts(spectrumData.background);

    /*
      Error Msg Problem with RAW Stream selection?
    */
    if (!(spectrumData.background.length == spectrumData.data.length || spectrumData.data.length == 0 || spectrumData.background.length == 0)) {
      popupNotification('data-error');
      if (background) { // Remove file again
        removeFile('background');
      } else {
        removeFile('data');
      }
    }

    plot.plotData(spectrumData, false);
    bindPlotEvents(); // needed, because of "false" above
  };

  reader.onerror = function() {
    popupNotification('file-error');
    return;
  };
}


function sizeCheck() {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  if (viewportWidth < 1250 || viewportHeight < 750) {
    popupNotification('screen-size-warning');
  } else {
    hideNotification('screen-size-warning');
  }
}


function removeFile(id) {
  spectrumData[id] = [];
  document.getElementById(id).value = '';
  plot.resetPlot(spectrumData);

  document.getElementById('total-spec-cts').innerText = spectrumData.getTotalCounts(spectrumData.data);
  document.getElementById('total-bg-cts').innerText = spectrumData.getTotalCounts(spectrumData.background);

  bindPlotEvents(); // Re-Bind Events for new plot
}


function bindPlotEvents() {
  const myPlot = document.getElementById(plot.divId);
  myPlot.on('plotly_hover', hoverEvent);
  myPlot.on('plotly_unhover', unHover);
  myPlot.on('plotly_click', clickEvent);
}


function selectFileType(button) {
  raw.fileType = button.value;
  raw.valueIndex = button.value;
}


function resetPlot() {
  if (plot.xAxis == 'log'){
    changeAxis(document.getElementById('xAxis'));
  }
  if (plot.yAxis == 'log'){
    changeAxis(document.getElementById('yAxis'));
  }
  if(plot.sma) {
    toggleSma(false, document.getElementById('sma'));
  }
  plot.clearAnnos();
  document.getElementById('check-all-isos').checked = false; // reset "select all" checkbox
  loadIsotopes(true);
  plot.resetPlot(spectrumData);
  bindPlotEvents(); // Fix Reset Bug: Hovering and Clicking not working.
}


function changeAxis(button) {
  if (plot[button.id] == 'linear') {
    plot[button.id] = 'log';
    button.innerText = 'Log';
  } else {
    plot[button.id] = 'linear';
    button.innerText = 'Linear';
  }
  plot.updatePlot(spectrumData);
}


function enterPress(event, id) {
  if (event.keyCode == 13) { // ENTER key
    const button = document.getElementById(id);
    button.click();
  }
}


function toggleSma(value, thisValue = null) {
  plot.sma = value;
  if (thisValue !== null) {
    thisValue.checked = false;
  }
  plot.updatePlot(spectrumData);
}


function changeSma(input) {
  const parsedInput = parseInt(input.value);
  if (isNaN(parsedInput)) {
    popupNotification('sma-error');
  } else {
    plot.smaLength = parsedInput;
    plot.updatePlot(spectrumData);
    saveJSON('smaLength', parsedInput);
  }
}


function hoverEvent(data) {
  const hoverData = document.getElementById('hover-data');
  hoverData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;

  for (const key in calClick) {
    if (calClick[key]) {
      document.getElementById('adc-' + key).value = data.points[0].x.toFixed(2);
    }
  }

  if (checkNearIso) {
    closestIso(data.points[0].x.toFixed(2));
  }
}


function unHover(data) {
  const hoverData = document.getElementById('hover-data');
  hoverData.innerText = 'None';

  for (const key in calClick) {
    if (calClick[key]) {
      document.getElementById('adc-' + key).value = oldCalVals[key];
    }
  }

  /*
  if (Object.keys(prevIso).length > 0) {
    closestIso(-maxDist); // Force Reset Iso Highlighting
  }
  */
}


function clickEvent(data) {
  const clickData = document.getElementById('click-data');
  clickData.innerText = data.points[0].x.toFixed(2) + data.points[0].xaxis.ticksuffix + ': ' + data.points[0].y.toFixed(2) + data.points[0].yaxis.ticksuffix;

  for (const key in calClick) {
    if (calClick[key]) {
      document.getElementById('adc-' + key).value = data.points[0].x.toFixed(2);
      oldCalVals[key] = data.points[0].x.toFixed(2);
      calClick[key] = false;
      document.getElementById('select-' + key).checked = calClick[key];
    }
  }
}


function toggleCal(enabled) {
  const button = document.getElementById('calibration-label');

  if (enabled) {
    button.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reset';
  } else {
    button.innerHTML = '<i class="fa-solid fa-check"></i> Calibrate';
  }
  /*
    Reset Plot beforehand, to prevent x-range from dying when zoomed?
  */
  if (enabled) {
    let readoutArray = [
      [document.getElementById('adc-a').value, document.getElementById('cal-a').value],
      [document.getElementById('adc-b').value, document.getElementById('cal-b').value],
      [document.getElementById('adc-c').value, document.getElementById('cal-c').value]
    ];

    let invalid = 0;
    let validArray = [];

    for (const pair of readoutArray) {
      const float1 = parseFloat(pair[0]);
      const float2 = parseFloat(pair[1]);

      if (isNaN(float1) || isNaN(float2)) {
        //pair[0] = undefined;
        //pair[1] = undefined;
        invalid += 1;
      } else {
        validArray.push([float1, float2]);
      }
      if (invalid > 1) {
        popupNotification('cal-error');
        return;
      }
    }

    plot.calibration.enabled = enabled;
    plot.calibration.points = validArray.length;

    if (validArray.length == 2) {
      validArray.push([undefined, undefined]);
    }

    plot.calibration.aFrom = validArray[0][0];
    plot.calibration.bFrom = validArray[1][0];
    plot.calibration.cFrom = validArray[2][0];
    plot.calibration.aTo = validArray[0][1];
    plot.calibration.bTo = validArray[1][1];
    plot.calibration.cTo = validArray[2][1];
  } else {
    plot.calibration.enabled = enabled;
  }
  plot.plotData(spectrumData, false);
  bindPlotEvents(); // needed, because of "false" above
}


function resetCal() {
  for (const point in calClick) {
    calClick[point] = false;
  }
  toggleCal(false);
}


function toggleCalClick(point, value) {
  calClick[point] = value;
}


function changeType(button) {
  if (plot.plotType == 'scatter') {
    button.innerHTML = '<i class="fas fa-chart-bar"></i> Bar';
    plot.plotType = 'bar';
  } else {
    button.innerHTML = '<i class="fas fa-chart-line"></i> Line';
    plot.plotType = 'scatter';
  }
  plot.updatePlot(spectrumData);
}


function importCal(input) {
  if (input.files.length == 0) { // File selection has been canceled
    return;
  }

  const file = input.files[0];
  let reader = new FileReader();

  reader.readAsText(file);

  reader.onload = function() {
    try {
      const result = reader.result.trim();
      const obj = JSON.parse(result);

      let readoutArray = [
        document.getElementById('adc-a'),
        document.getElementById('cal-a'),
        document.getElementById('adc-b'),
        document.getElementById('cal-b'),
        document.getElementById('adc-c'),
        document.getElementById('cal-c')
      ];

      const inputArr = ['aFrom', 'aTo', 'bFrom', 'bTo', 'cFrom', 'cTo'];
      for (const index in inputArr) {
        readoutArray[index].value = parseFloat(obj[inputArr[index]]);
      }

      oldCalVals.a = readoutArray[0].value;
      oldCalVals.b = readoutArray[2].value;
      oldCalVals.c = readoutArray[4].value;

    } catch(e) {
      console.log('Calibration Import Error:', e);
      popupNotification('cal-import-error');
    }
  };

  reader.onerror = function() {
    popupNotification('file-error');
    return;
  };
}


function addLeadingZero(timeNumber) {
  if (timeNumber < 10) {
    return '0' + timeNumber;
  } else {
    return timeNumber;
  }
}


function getDateString() {
  const time = new Date();
  return time.getFullYear() + addLeadingZero(time.getMonth() + 1) + addLeadingZero(time.getDate()) + addLeadingZero(time.getHours()) + addLeadingZero(time.getMinutes());
}


function downloadCal() {
  filename = 'calibration_' + getDateString() + '.json';
  download(filename, plot.calibration, true);
}


function downloadData(filename, data) {
  filename += '_' + getDateString() + '.csv';

  text = '';
  spectrumData[data].forEach(item => {
    text += item + '\n';
  });

  download(filename, text);
}


function download(filename, text, json=false) {
    var element = document.createElement('a');
    if (json) {
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(JSON.stringify(text)));
    } else {
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    }

    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}


function popupNotification(id) {
  // Uses Bootstrap Toasts already defined in HTML
  const element = document.getElementById(id);
  const toast = new bootstrap.Toast(element);
  toast.show();
}


function hideNotification(id) {
  const element = document.getElementById(id);
  const toast = new bootstrap.Toast(element);
  toast.hide();
}


let loadedIsos = false;

async function loadIsotopes(reload = false) { // Load Isotope Energies JSON ONCE
  if (loadedIsos && !reload) { // Isotopes already loaded
    return true;
  }

  const loadingElement = document.getElementById('iso-loading');
  loadingElement.className = loadingElement.className.replaceAll(' visually-hidden', '');

  const options = {
    cache: 'no-cache',
    headers: {
      'Content-Type': 'text/plain; application/json; charset=UTF-8',
    },
  };

  const isoError = document.getElementById('iso-load-error');
  //isoError.innerText = ''; // Remove any old error msges
  isoError.className += ' visually-hidden'; // Hide any old errors
  let successFlag = true; // Ideally no errors

  try {
    let response = await fetch(isoListURL, options);

    if (response.ok) { // If HTTP-status is 200-299
      const json = await response.json();
      loadedIsos = true;

      const tableElement = document.getElementById('iso-table');
      tableElement.innerHTML = ''; // Delete old table
      plot.clearAnnos(); // Delete all isotope lines
      plot.updatePlot(spectrumData);

      let intKeys = Object.keys(json);
      intKeys.sort((a, b) => a - b); // Sort Energies numerically

      let index = 0; // Index used to avoid HTML id duplicates

      for (const key of intKeys) {
        index++;
        isoList[key] = json[key];

        const row = tableElement.insertRow();
        const cell1 = row.insertCell(0);
        const cell2 = row.insertCell(1);
        const cell3 = row.insertCell(2);

        cell2.addEventListener('click', function(evnt) {
          try {
            evnt.target.parentNode.firstChild.firstChild.click();
          } catch(e) { // Catch press on <sup> element
            ; //evnt.target.parentNode.parentNode.firstChild.firstChild.click();
          }
        });
        cell3.addEventListener('click', function(evnt) {
          try {
            evnt.target.parentNode.firstChild.firstChild.click();
          } catch(e) { // Catch press on <sup> element
            ; //evnt.target.parentNode.parentNode.firstChild.firstChild.click();
          }
        });

        cell2.style.cursor = 'pointer'; // change cursor pointer
        cell3.style.cursor = 'pointer';

        const energy = parseFloat(key.trim());
        const dirtyName = json[key].toLowerCase();
        const lowercaseName = dirtyName.replace(/[^a-z0-9 -]/gi, '').trim(); // Fixes security issue. Clean everything except for letters, numbers and minus. See GitHub: #2
        const name = lowercaseName.charAt(0).toUpperCase() + lowercaseName.slice(1) + '-' + index; // Capitalize Name and append index number

        cell1.innerHTML = '<input class="form-check-input" id="' + name + '" type="checkbox" value="' + energy + '" onclick="plotIsotope(this)">';
        cell3.innerHTML = '<label for="' + name + '">' +  energy.toFixed(2) + '</label>';

        const strArr = name.split('-');

        cell2.innerHTML = '<label for="' + name + '"><sup>' + strArr[1] + '</sup>' + strArr[0] + '</label>';
      }
    } else {
      isoError.innerText = 'Could not load isotope list! HTTP Error: ' + response.status + '. Please try again.';
      isoError.className = isoError.className.replaceAll(' visually-hidden', '');
      successFlag = false;
    }
  } catch (err) { // No network connection!
    isoError.innerText = 'Could not load isotope list! Connection refused - you are probably offline.';
    isoError.className = isoError.className.replaceAll(' visually-hidden', '');
    successFlag = false;
  }

  loadingElement.className += ' visually-hidden';
  return successFlag;
}


function reloadIsotopes() {
  //loadedIsos = false;
  loadIsotopes(true);
}


let prevIso = {};

function toggleIsoHover() {
  checkNearIso = !checkNearIso;
  closestIso(-100000);
}


async function closestIso(value) {
  // VERY BAD PERFORMANCE, EXPERIMENTAL FEATURE!
  if(!await loadIsotopes()) { // User has not yet opened the settings panel
    return;
  }

  const keys = Object.keys(isoList);
  const closeKeys = keys.filter((energy) => {return Math.abs(energy - value) <= maxDist});

  if (closeKeys.length !== 0) {
    let closest = closeKeys.reduce(function(prev, curr) {
      return (Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev);
    });

    plot.toggleLine(Object.keys(prevIso)[0], Object.values(prevIso)[0], false);

    let newIso = {};
    newIso[parseFloat(closest).toFixed(2)] = isoList[closest];

    if (prevIso !== newIso) {
      prevIso = newIso;
    }

    plot.toggleLine(parseFloat(closest).toFixed(2), isoList[closest]);
    plot.updatePlot(spectrumData);
  } else if (Object.keys(prevIso).length !== 0) {
    plot.toggleLine(Object.keys(prevIso)[0], Object.values(prevIso)[0], false);
    plot.updatePlot(spectrumData);
  }

}


function plotIsotope(checkbox) {
  const wordArray = checkbox.id.split('-');
  const name = wordArray[0] + '-' + wordArray[1];
  plot.toggleLine(checkbox.value, name, checkbox.checked);
  plot.updatePlot(spectrumData);
}


function selectAll(selectBox) {
  // Bad performance because of the updatePlot with that many lines!
  const tableElement = selectBox.closest('table');
  const tableBody = tableElement.tBodies[0];
  const tableRows = tableBody.rows;

  for (const row of tableRows) {
    const checkBox = row.cells[0].firstChild;
    checkBox.checked = selectBox.checked;
    if (selectBox.checked) {
      const wordArray = checkBox.id.split('-');
      const name = wordArray[0] + '-' + wordArray[1];
      plot.toggleLine(checkBox.value, name, checkBox.checked);
    }
  }
  if (!selectBox.checked) {
    plot.shapes = [];
    plot.annotations = [];
  }

  plot.updatePlot(spectrumData);
}


function findPeaks(checkbox) {
  plot.peakConfig.enabled = checkbox.checked;
  if (!checkbox.checked) { // disabled
    plot.peakFinder(false);
  }
  plot.updatePlot(spectrumData);
}

/*
=========================================
  LOADING AND SAVING
=========================================
*/

function saveJSON(name, value) {
  localStorage.setItem(name, JSON.stringify(value));
}


function loadJSON(name) {
  return JSON.parse(localStorage.getItem(name));
}


function loadSettingsDefault() {
  document.getElementById('custom-url').value = isoListURL;
  document.getElementById('edit-plot').checked = plot.editableMode;
  document.getElementById('custom-delimiter').value = raw.delimiter;
  document.getElementById('custom-file-adc').value = raw.adcChannels;
  document.getElementById('custom-ser-refresh').value = refreshRate / 1000; // convert ms to s
  document.getElementById('custom-ser-buffer').value = ser.maxSize;
  document.getElementById('custom-ser-adc').value = ser.adcChannels;
  const autoStop = document.getElementById('ser-limit');
  autoStop.value = maxRecTime / 1000; // convert ms to s
  autoStop.disabled = !maxRecTimeEnabled;
  document.getElementById('ser-limit-btn').disabled = !maxRecTimeEnabled;
  document.getElementById('toggle-time-limit').checked = maxRecTimeEnabled;
  document.getElementById('iso-hover-prox').value = maxDist;
  document.getElementById('custom-baud').value = serOptions.baudRate;
  document.getElementById('eol-char').value = ser.eolChar;

  document.getElementById('smaVal').value = plot.smaLength;

  document.getElementById('peak-thres').value = plot.peakConfig.thres;
  document.getElementById('peak-lag').value = plot.peakConfig.lag;
  document.getElementById('peak-width').value = plot.peakConfig.width;
}


function loadSettingsStorage() {
  let setting = loadJSON('customURL');
  if (setting) {
    const newUrl = new URL(setting);
    isoListURL = newUrl.href;
  }
  setting = loadJSON('editMode');
  if (setting) {
    plot.editableMode = setting;
  }
  setting = loadJSON('fileDelimiter');
  if (setting) {
    raw.delimiter = setting;
  }
  setting = loadJSON('fileChannels');
  if (setting) {
    raw.adcChannels = setting;
  }
  setting = loadJSON('plotRefreshRate');
  if (setting) {
    refreshRate = setting;
  }
  setting = loadJSON('serBufferSize');
  if (setting) {
    ser.maxSize = setting;
  }
  setting = loadJSON('serADC');
  if (setting) {
    ser.adcChannels = setting;
  }
  setting = loadJSON('timeLimitBool');
  if (setting) {
    maxRecTimeEnabled = setting;
  }
  setting = loadJSON('timeLimit');
  if (setting) {
    maxRecTime = setting;
  }
  setting = loadJSON('maxIsoDist');
  if (setting) {
    maxDist = setting;
  }
  setting = loadJSON('baudRate');
  if (setting) {
    serOptions.baudRate = setting;
  }
  setting = loadJSON('eolChar');
  if (setting) {
    ser.eolChar = setting;
  }
  setting = loadJSON('smaLength');
  if (setting) {
    plot.smaLength = setting;
  }
  setting = loadJSON('peakThres');
  if (setting) {
    plot.peakConfig.thres = setting;
  }
  setting = loadJSON('peakLag');
  if (setting) {
    plot.peakConfig.lag = setting;
  }
  setting = loadJSON('peakWidth');
  if (setting) {
    plot.peakConfig.width = setting;
  }
}


function changeSettings(name, element) {
  if (!element.checkValidity()) {
    popupNotification('setting-type');
    return;
  }

  let value = element.value;

  switch (name) {
    case 'editMode':
      value = element.checked;
      plot.editableMode = value;
      plot.resetPlot(spectrumData);

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'customURL':
      try {
        const newUrl = new URL(value);
        isoListURL = newUrl.href;

        reloadIsotopes();

        if (localStorageAvailable) {
          saveJSON(name, isoListURL);
        }

      } catch(e) {
        popupNotification('setting-error');
        console.log('Custom URL Error', e);
      }
      break;

    case 'fileDelimiter':
      raw.delimiter = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'fileChannels':
      value = parseInt(value);
      raw.adcChannels = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'timeLimitBool':
      value = element.checked;
      document.getElementById('ser-limit').disabled = !value;
      document.getElementById('ser-limit-btn').disabled = !value;

      maxRecTimeEnabled = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'timeLimit':
      value = parseFloat(value);
      maxRecTime = value * 1000; // convert s to ms

      if (localStorageAvailable) {
        saveJSON(name, maxRecTime);
      }
      break;

    case 'maxIsoDist':
      value = parseFloat(value);
      maxDist = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'plotRefreshRate':
      value = parseFloat(value);
      refreshRate = value * 1000; // convert s to ms

      if (localStorageAvailable) {
        saveJSON(name, refreshRate);
      }
      break;

    case 'serBufferSize':
      value = parseInt(value);
      ser.maxSize = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'baudRate':
      value = parseInt(value);
      serOptions.baudRate = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'eolChar':
      serOptions.eolChar = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'serChannels':
      value = parseInt(value);
      ser.adcChannels = value;

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'peakThres':
      value = parseFloat(value);
      plot.peakConfig.thres = value;
      plot.updatePlot(spectrumData);

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'peakLag':
      value = parseInt(value);
      plot.peakConfig.lag = value;
      plot.updatePlot(spectrumData);

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    case 'peakWidth':
      value = parseInt(value);
      plot.peakConfig.width = value;
      plot.updatePlot(spectrumData);

      if (localStorageAvailable) {
        saveJSON(name, value);
      }
      break;

    default:
      popupNotification('setting-error');
      return;
  }
  popupNotification('setting-success'); // Success Toast
}


function resetMCA() {
  if (localStorageAvailable) {
    localStorage.clear();
  }
  window.location.reload();
}

/*
=========================================
  SERIAL DATA
=========================================
*/

function serialConnect(event) {
  listSerial();
  popupNotification('serial-connect');
};


function serialDisconnect(event) {
  for (const key in portsAvail) {
    if (portsAvail[key] == event.target) {
      delete portsAvail[key];
      break;
    }
  }
  if (event.target == ser.port) {
    disconnectPort(true);
  }

  listSerial();

  popupNotification('serial-disconnect');
};


async function listSerial() {
  const portSelector = document.getElementById('port-selector');
  for (const index in portSelector.options) { // Remove all "old" ports
    portSelector.remove(index);
  }

  const ports = await navigator.serial.getPorts();

  for (const index in ports) { // List new Ports
    portsAvail[index] = ports[index];

    const option = document.createElement("option");
    option.text = 'Port ' + index + ' (Id: ' + ports[index].getInfo().usbProductId + ')';
    portSelector.add(option, index);
  }

  const serSettingsElements = document.getElementsByClassName('ser-settings');

  if (ports.length == 0) {
    const option = document.createElement("option");
    option.text = 'No Ports Available';
    portSelector.add(option);

    for (const element of serSettingsElements) {
      element.disabled = true;
    }
  } else {
    for (const element of serSettingsElements) {
      element.disabled = false;
    }
  }
}


async function requestSerial() {
  try {
    const port = await navigator.serial.requestPort();

    if (Object.keys(portsAvail).length == 0) {
      portsAvail[0] = port;
    } else {
      const keys = Object.keys(portsAvail);
      const max = Math.max(...keys);
      portsAvail[max+1] = port; // Put new port in max+1 index  to get a new, unused number
    }
    listSerial();
  } catch(err) {
    console.log('Aborted adding a new port!', err); // Do nothing.
  }
}


function toggleCps(button, off = false) {
  if (off) { // Override
    plot.cps = false;
  } else {
    plot.cps = !plot.cps;
  }

  if (plot.cps) {
    button.innerText = 'CPS';
  } else {
    button.innerText = 'Total';
  }
  plot.updatePlot(spectrumData);
}


async function selectPort() {
  const selector = document.getElementById('port-selector');
  const index = selector.selectedIndex;
  ser.port = portsAvail[index];
}


let keepReading = false;
let reader;
let recordingType = '';
let startTime = 0;
let timeDone = 0;

async function readUntilClosed() {
  while (ser.port.readable && keepReading) {
    try {
      reader = ser.port.readable.getReader();

      while (true) {
        const {value, done} = await reader.read();
        if (value) {
          // value is a Uint8Array.
          ser.addRaw(value);
        }
        if (done) {
          // reader.cancel() has been called.
          break;
        }
      }
    } catch (err) {
      // Sudden device disconnect can cause this
      console.log('Misc Serial Read Error:', err);
      popupNotification('misc-ser-error');
    } finally {
      // Allow the serial port to be closed later.
      reader.releaseLock();
      reader = undefined;
    }
  }

  await ser.port.close();
}


let closed;
let firstLoad = false;

async function startRecord(pause = false, type = recordingType) {
  try {
    selectPort();
    await ser.port.open(serOptions); // Baud-Rate optional

    keepReading = true; // Reset keepReading
    recordingType = type;

    if (!pause) {
      removeFile(recordingType); // Remove old spectrum
      firstLoad = true;
    }

    document.getElementById('export-button').disabled = false;
    document.getElementById('stop-button').disabled = false;
    document.getElementById('pause-button').className = document.getElementById('pause-button').className.replaceAll(' visually-hidden','');
    document.getElementById('record-button').className += ' visually-hidden';
    document.getElementById('resume-button').className += ' visually-hidden';
    document.getElementById('recording-spinner').className = document.getElementById('recording-spinner').className.replaceAll(' visually-hidden','');

    const timer = new Date();
    startTime = timer.getTime();

    refreshRender(recordingType); // Start updating the plot
    refreshMeta(recordingType); // Start updating the meta data

    cpsValues.shift(); // First cps value is always a zero, so remove that.

    closed = readUntilClosed();
  } catch(err) {
    console.log('Connection Error:', err);
    popupNotification('serial-connect-error');
  }
}


async function sendSerial(command) {
  const wasReading = keepReading;

  try {
    if (wasReading) {
      await disconnectPort();
    }

    selectPort();
    await ser.port.open(serOptions); // Baud-Rate optional

    const textEncoder = new TextEncoderStream();
    const writer = textEncoder.writable.getWriter();
    const writableStreamClosed = textEncoder.readable.pipeTo(ser.port.writable);

    let formatCommand = command.trim() + '\n';

    writer.write(formatCommand);
    //writer.write('\x03\n');

    //writer.releaseLock();
    await writer.close();
    await writableStreamClosed;

    document.getElementById('ser-output').innerText += '> ' + formatCommand.trim() + '\n';
    document.getElementById('ser-command').value = "";

  } catch (err) {
    console.log('Connection Error:', err);
    popupNotification('serial-connect-error');
  } finally {

    await ser.port.close();

    if (wasReading) {
      startRecord(true);
    }

  }
}


async function disconnectPort(stop = false) {
  const nowTime = new Date();
  timeDone += nowTime.getTime() - startTime;

  document.getElementById('pause-button').className += ' visually-hidden';
  document.getElementById('recording-spinner').className += ' visually-hidden';

  if (stop) {
    document.getElementById('stop-button').disabled = true;
    document.getElementById('record-button').className = document.getElementById('record-button').className.replaceAll(' visually-hidden','');
    document.getElementById('resume-button').className += ' visually-hidden';
    recordingType = '';
    timeDone = 0;
    cpsValues = [];

    const cpsButton = document.getElementById('plot-cps');
    toggleCps(cpsButton, true); // Disable CPS again
  } else {
    document.getElementById('resume-button').className = document.getElementById('resume-button').className.replaceAll(' visually-hidden','');
  }

  keepReading = false;
  ser.flushData(); // Remove all old data

  try {
    clearTimeout(refreshTimeout);
    clearTimeout(metaTimeout);
  } catch (err) {
    console.log('No timeout to clear.', err);
  }

  try {
    if (typeof reader !== 'undefined') {
      reader.cancel();
    }
  } catch(err) {
    console.log('Nothing to disconnect.', err);
  }
  await closed;
}


let metaTimeout;

function refreshMeta(type) {
  if (ser.port.readable && keepReading) {
    const totalTimeElement = document.getElementById('total-record-time');
    const timeElement = document.getElementById('record-time');
    const progressBar = document.getElementById('ser-time-progress-bar');

    const nowTime = new Date();
    const delta = new Date(nowTime.getTime() - startTime + timeDone);

    timeElement.innerText = addLeadingZero(delta.getUTCHours()) + ':' + addLeadingZero(delta.getUTCMinutes()) + ':' + addLeadingZero(delta.getUTCSeconds());

    if (maxRecTimeEnabled) {
      const progressElement = document.getElementById('ser-time-progress');
      const progress = Math.round(delta.getTime() / maxRecTime * 100);
      progressElement.style.width = progress + '%';
      //progressElement.innerText = progress + '%';
      progressElement.setAttribute('aria-valuenow', progress)

      const totalTime = new Date(maxRecTime);
      totalTimeElement.innerText = ' / ' +  addLeadingZero(totalTime.getUTCHours()) + ':' + addLeadingZero(totalTime.getUTCMinutes()) + ':' + addLeadingZero(totalTime.getUTCSeconds());
      progressBar.className = progressBar.className.replaceAll(' visually-hidden','');
    } else {
      totalTimeElement.innerText = '';
      progressBar.className += ' visually-hidden';
    }

    if (delta > maxRecTime && maxRecTimeEnabled) {
      disconnectPort(true);
      popupNotification('auto-stop');
    } else {
      metaTimeout = setTimeout(refreshMeta, REFRESH_META_TIME, type); // Only re-schedule if still valid
    }
  }
}


let lastUpdate = new Date();
let refreshTimeout;

function refreshRender(type) {
  if (ser.port.readable && keepReading) {
    const nowTime = new Date();
    const delta = new Date(nowTime.getTime() - startTime + timeDone);

    const newData = ser.getData();

    spectrumData[type] = ser.updateData(spectrumData[type], newData); // Depends on Background/Spectrum Aufnahme
    spectrumData[type + 'Cps'] = spectrumData[type].map(val => val / delta.getTime() * 1000);

    if (firstLoad) {
      plot.plotData(spectrumData, false);
      bindPlotEvents(); // needed, because of "false" above
      firstLoad = false;
    } else {
      plot.updatePlot(spectrumData);
    }

    const deltaLastRefresh = new Date(nowTime.getTime() - lastUpdate.getTime());
    lastUpdate = nowTime;

    const cpsValue = newData.length / deltaLastRefresh.getTime() * 1000;
    document.getElementById('cps').innerText = cpsValue.toFixed(1) + ' cps';

    cpsValues.push(cpsValue);

    let mean = 0;
    cpsValues.forEach((item, i) => {
      mean += item;
    });
    mean /= cpsValues.length;

    document.getElementById('avg-cps').innerHTML = 'Avg: ' + mean.toFixed(1);

    let std = 0;
    cpsValues.forEach((item, i) => {
      std += Math.pow(item - mean, 2);
    });
    std /= (cpsValues.length - 1);
    std = Math.sqrt(std);

    document.getElementById('avg-cps-std').innerHTML = ' &plusmn; ' + std.toFixed(1) + ' cps' + ' (&#916; ' + Math.round(std/mean*100) + '%)';

    document.getElementById('total-spec-cts').innerText = spectrumData.getTotalCounts(spectrumData.data);
    document.getElementById('total-bg-cts').innerText = spectrumData.getTotalCounts(spectrumData.background);

    refreshTimeout = setTimeout(refreshRender, refreshRate, type); // Only re-schedule if still avail
  }
}
