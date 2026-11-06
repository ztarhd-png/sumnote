'use strict';
// 업데이트 전달 규칙
// - 화면 파일(HTML·CSS·JS·manifest)은 온라인이면 항상 새로 받고, 받은 것을 캐시에 덮어쓴다.
//   네트워크가 끊겼거나 4초 안에 답이 없으면 캐시 사본을 보여 준다.
// - 글꼴·아이콘은 잘 바뀌지 않으므로 캐시를 먼저 쓴다.
// 그래서 app.js나 styles.css만 고쳐도 다음 실행 때 홈 화면 앱에 반영된다.
// 글꼴·아이콘 파일을 바꾸거나 캐시 목록(ASSETS)을 바꿀 때만 CACHE 버전을 올린다.
const CACHE = 'sumnote-v3';
const ASSETS = ['./', './index.html', './styles.css', './parser.js', './app.js', './manifest.webmanifest',
  './fonts/PretendardVariable.woff2', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
const STATIC = /\/(fonts|icons)\//;
const TIMEOUT = 4000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('sumnote-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), TIMEOUT);
    fetch(request, { cache: 'no-cache' }).then(response => {
      clearTimeout(timer);
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
      resolve(response);
    }, error => { clearTimeout(timer); reject(error); });
  });
}

async function fromCache(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === 'navigate') { const shell = await caches.match('./index.html'); if (shell) return shell; }
  throw Error('offline');
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (STATIC.test(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fromNetwork(request)));
    return;
  }
  event.respondWith(fromNetwork(request).catch(() => fromCache(request)));
});
