'use strict';
// 업데이트 전달 규칙 (사용자가 누를 때만 바뀐다)
// - 앱은 항상 지금 설치된 버전의 캐시에서 열린다. 오프라인에서도 같다.
// - 브라우저가 앱을 열 때마다 이 파일(sw.js)이 바뀌었는지 확인한다. 바뀌었으면 새 버전을 뒤에서 받아 두고 기다린다.
// - 화면 위쪽에 작은 '업데이트' 버튼이 뜨고, 누르면 새 버전으로 바꾼 뒤 다시 연다.
// ★ 배포할 때마다 VERSION을 반드시 올린다. 올리지 않으면 사용자에게 업데이트가 전달되지 않는다.
const VERSION = '2026.11.09.24';
const CACHE = 'sumnote-' + VERSION;
const ASSETS = ['./', './index.html', './styles.css', './parser.js', './ai.js', './app.js', './manifest.webmanifest',
  './fonts/PretendardVariable.woff2', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  // HTTP 캐시를 건너뛰고 새 파일을 받는다. 다 받기 전에는 설치되지 않으므로 반쪽 업데이트가 생기지 않는다.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('sumnote-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  else if (event.data === 'version' && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    return cached || fetch(request);
  }));
});
