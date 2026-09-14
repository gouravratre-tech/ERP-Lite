/**
 * Drop-in replacement for the `google.script.run` object that Google Apps Script
 * normally injects. The original app code calls things like:
 *
 *   google.script.run
 *     .withSuccessHandler(fn)
 *     .withFailureHandler(fn2)
 *     .addCustomer(payload);
 *
 * ...or, for dynamically-named calls:
 *
 *   google.script.run.withSuccessHandler(fn)[someVariableFunctionName](payload);
 *
 * This shim supports both call styles unchanged. Every call is forwarded as a
 * JSON POST to /api/rpc on our own local Express server (see server/index.js),
 * which dispatches to the matching function in server/rpc.js.
 */
(function () {
  function makeRunner(successHandler, failureHandler) {
    return new Proxy({}, {
      get(target, propName) {
        if (propName === 'withSuccessHandler') {
          return function (fn) { return makeRunner(fn, failureHandler); };
        }
        if (propName === 'withFailureHandler') {
          return function (fn) { return makeRunner(successHandler, fn); };
        }
        if (propName === 'withUserObject') {
          // Not needed locally — accepted for API compatibility, ignored.
          return function () { return makeRunner(successHandler, failureHandler); };
        }
        // Any other property access is treated as the actual server function name.
        return function (...args) {
          fetch('/api/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fn: propName, args: args })
          })
            .then((r) => r.json())
            .then((res) => {
              if (res && res.error) {
                if (failureHandler) failureHandler({ message: res.error });
                else console.error('[gas-shim]', propName, res.error);
              } else if (successHandler) {
                successHandler(res ? res.result : undefined);
              }
            })
            .catch((err) => {
              if (failureHandler) failureHandler({ message: err.message || String(err) });
              else console.error('[gas-shim]', propName, err);
            });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);
})();
