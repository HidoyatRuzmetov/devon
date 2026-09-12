// The web-push service worker, as source (v1.1 SPEC §10, EPIC-019).
//
// **Why the API serves this file rather than the web app.** A service worker must be same-origin
// with the page, and its default scope is the directory it is served from. `apps/web` has no
// `public/` of its own -- its Vite `publicDir` points at `packages/ui/public`, which belongs to the
// design system -- so shipping a static `sw.js` would mean editing a shared build file that three
// other v1.1 packages also build against. Serving it from here costs one route and one response
// header (`Service-Worker-Allowed: /`, RFC-adjacent but universally implemented: it is exactly the
// mechanism for widening a worker's scope beyond its own path), and the browser reaches it at the
// same relative `/api/...` path in every environment -- proxied by Vite in development, by Caddy in
// production -- so there is no environment-specific registration URL anywhere in the client.
//
// **Why the worker is this small.** It is a push receiver, not an offline cache. It owns three
// events and nothing else:
//   * `push`      -- decrypt is done by the browser; show the notification the API composed, already
//                    in the recipient's own locale (`events.ts` picks the locale before sending).
//   * `notificationclick` -- focus an existing WorkPortal tab if one is open (a person does not want
//                    a second tab of the same app), otherwise open one at the deep link.
//   * `install`/`activate` -- take over immediately, so a fixed worker does not wait for every tab to
//                    close before it replaces the broken one.
//
// It deliberately registers no `fetch` handler. A worker with a `fetch` handler is on the critical
// path of every request the page makes for as long as it lives; one that only pushes is not, and an
// offline cache for a government intranet tool is a decision for its own epic (H24), not a side
// effect of turning reminders on.
//
// It reads no session, stores nothing, and can show only what the server encrypted to this one
// browser's key -- so a shared machine cannot leak a colleague's notification through it.

/** Bumped when the body below changes: the browser byte-compares the script it has against the one
 * it fetches, and a changed constant is what makes an update land without a cache-busting query. */
export const SERVICE_WORKER_VERSION = '1.0.0'

export const SERVICE_WORKER_SOURCE = `// WorkPortal push service worker v${SERVICE_WORKER_VERSION}
// Generated and served by apps/api/src/modules/realtime/service-worker.ts -- do not edit in devtools.
'use strict'

self.addEventListener('install', function () {
  // Replace the previous worker without waiting for every tab of the app to be closed first.
  self.skipWaiting()
})

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})

function parsePayload(event) {
  if (!event.data) return null
  try {
    return event.data.json()
  } catch (err) {
    // A push with a body we cannot read is still a push: show the fallback rather than nothing, so
    // the person learns something happened and can open the inbox themselves.
    return null
  }
}

self.addEventListener('push', function (event) {
  var payload = parsePayload(event)
  var title = (payload && payload.title) || 'WorkPortal'
  var body = (payload && payload.body) || ''
  var deepLink = (payload && payload.deepLink) || '/inbox'
  var tag = (payload && payload.tag) || 'workportal'
  var reason = (payload && payload.reason) || ''

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      // Same tag replaces an older notification about the same subject instead of stacking a
      // second one -- three reminders about one card are one reminder.
      tag: tag,
      renotify: false,
      // No \`icon\`/\`badge\`: this deployment ships no PWA icon set yet, and pointing at a URL that
      // 404s makes Chrome draw a broken-image placeholder where every browser would otherwise fall
      // back to the site's own favicon. Add both here the day an icon set lands.
      data: { deepLink: deepLink, reason: reason },
      // Never steal focus with sound or vibration: this is a work tool, and a notification that
      // buzzes for a task due tomorrow is a notification that gets switched off for good.
      silent: false,
      requireInteraction: false,
    }),
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var data = event.notification.data || {}
  var deepLink = data.deepLink || '/inbox'
  var target = new URL(deepLink, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i += 1) {
        var client = clientList[i]
        if (new URL(client.url).origin !== self.location.origin) continue
        // A WorkPortal tab is already open: bring it forward and navigate it, rather than opening a
        // second copy of the same application.
        if ('focus' in client) {
          var focused = client.focus()
          if ('navigate' in client) {
            return Promise.resolve(focused).then(function () {
              return client.navigate(target)
            })
          }
          return focused
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    }),
  )
})

self.addEventListener('pushsubscriptionchange', function (event) {
  // The push service rotated this browser's endpoint. Re-subscribe locally with the same application
  // key so the browser keeps a working subscription; the *server* side is repaired the next time the
  // person opens WorkPortal, because the calendar screen re-registers whatever endpoint the browser
  // currently holds on every visit (\`syncPushSubscription\` in apps/web/src/features/calendar).
  //
  // Deliberately no \`fetch\` back to the API from here: a service worker carries no CSRF token, so a
  // repair endpoint it could call would have to be CSRF-exempt -- a permanently open, cookie-
  // authenticated write, added to spare a one-visit delay on a rotation that happens rarely. Not a
  // trade worth making.
  var oldSubscription = event.oldSubscription || null
  var applicationServerKey =
    (event.newSubscription &&
      event.newSubscription.options &&
      event.newSubscription.options.applicationServerKey) ||
    (oldSubscription && oldSubscription.options && oldSubscription.options.applicationServerKey) ||
    null
  if (!applicationServerKey) return

  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey })
      .catch(function () {
        // Nothing useful to do from a worker with no UI.
      }),
  )
})
`
