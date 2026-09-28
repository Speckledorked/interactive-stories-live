// src/lib/authFlag.ts
//
// Whether the visitor is signed in, expressed as an attribute on <html>
// before first paint.
//
// `/` is one page serving two audiences: a stranger who needs "Create your
// account" and a returning player who needs "Continue to your campaigns".
// The server renders BOTH calls to action and this decides which one is
// visible. The root layout sets the initial value from the access cookie
// (the server can read httpOnly cookies on the page request itself); this
// script is the client-side-navigation fallback — App Router navigations
// do not re-run the root layout, so after a login/logout without a full
// reload the localStorage hint below is what keeps the attribute current.
//
// It has to happen before paint, not in an effect. A useEffect swap would
// paint "Create your account" at someone who has been playing for a month
// and then correct itself, which is exactly the flash THEME_INIT_SCRIPT
// exists to prevent for the palette — same problem, same shape of answer.
// See lib/theme.ts, whose header makes the argument in full.
//
// Deliberately NOT a validity check, and deliberately NOT the token. This
// reads the non-credential signed-in flag (lib/clientAuth.ts sets it on
// login/signup/refresh and clears it on logout): "a session is believed
// live", not "a session is good". Verifying would need a round trip, which
// is the one thing that cannot happen before paint. A stale flag therefore
// shows the signed-in call to action, and clicking it lands on /campaigns,
// which guards itself and redirects to /login. A wrong guess costs one
// redirect; guessing late costs every returning player a flicker.

/** Mirrors SIGNED_IN_KEY in lib/clientAuth.ts. A display hint, not a
 * credential — the actual session is in httpOnly cookies. */
export const AUTH_SIGNED_IN_STORAGE_KEY = 'ai_gm_signed_in'

/** Set on <html> while a token is present. Styled against in globals.css. */
export const SIGNED_IN_ATTRIBUTE = 'data-signed-in'

/**
 * Runs in <head> before first paint. Kept tiny and try/caught for the same
 * reason the theme script is: it is among the first things on the page, and
 * an exception here would precede everything else. Duplicates the storage
 * key rather than importing it, because importing would defeat the point.
 */
export const AUTH_FLAG_INIT_SCRIPT = `(function(){try{if(localStorage.getItem('${AUTH_SIGNED_IN_STORAGE_KEY}')){document.documentElement.setAttribute('${SIGNED_IN_ATTRIBUTE}','')}}catch(e){}})()`
