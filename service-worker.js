/*

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  Service Worker for Progressive Web App!

  ===============================

  Possible Future Improvements:
    - Add all important files to OFFLINE_RESOURCES

*/
const APP_VERSION = '2022-04-25';
const CACHE_NAME = "gamma-static"; // A random name for the cache
const OFFLINE_RESOURCES = ['/',
                          '/index.html',
                          '/404.html'];


self.addEventListener("install", function(event) { // First time install of a worker
  console.log('Installing service worker.');

  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      /*
      for (const URL of OFFLINE_RESOURCES) { // Remove old cached files
        cache.delete(URL, {ignoreSearch: true, ignoreMethod: true});
      }
      */
      clearCache(); // Clear the whole cache
      return cache.addAll(OFFLINE_RESOURCES); // Cache all important files
    })
  );

  self.skipWaiting(); // Forces the waiting service worker to become the active service worker
});


self.addEventListener("activate", function(event) { // New worker takes over
  console.log('Activating service worker.');
  self.clients.claim(); // Allows an active service worker to set itself as the controller for all clients within its scope
});


self.addEventListener("fetch", function(event) {
  //console.log('mode', event.request.mode);

  event.respondWith(async function() {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);

    if (cachedResponse) { // Try to load from cache first, way faster
      //console.log('Cache Response!', cachedResponse);
      updateCache(event.request); // Always also try to update the cache, dont wait for it though
      return cachedResponse;
    };

    try {  // Not found in cache -- request from network
      const networkResponse = await fetch(event.request);

      //console.log('Network Response!', networkResponse);
      cache.put(event.request, networkResponse.clone());
      return networkResponse;
    } catch (error) { // Did not find in cache or network, probably new page and offline access!
      throw error;
    }
  }());
});


async function clearCache() {
  const cache = await caches.open(CACHE_NAME);

  cache.keys().then(function(keys) { // Delete the whole cache
    keys.forEach(function(request, index, array) {
      //console.log('Clearing cache!', request);
      cache.delete(request);
    });
  });
}


async function updateCache(request) {
  try {
    const response = await fetch(request);

    //console.log('Updating Cache!', response);
    cache.put(request, response.clone());
  } catch (e) {
    ; // Ignore, not critical after all. Probably just offline
  }
}