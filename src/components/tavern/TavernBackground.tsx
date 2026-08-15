// Full-bleed backdrop shared by every page.
//
// A myth-canvas fill, theme-adaptive rather than permanently dark. Dark
// mode gets a soft radial vignette so it reads as moody depth rather than
// flat near-black; light mode stays a flat parchment fill, which needs no
// such treatment.
//
// This used to take a `variant` prop selecting between this and a
// candlelit-tavern art backdrop (a background image plus ember/wine
// gradient overlays, always dark). Every page is on the myth system now,
// so that branch had no callers left and is gone along with the prop —
// see docs/design-system.md. public/images/tavern-bg.jpg is likewise no
// longer referenced by anything.
export function TavernBackground() {
  return (
    <div className="fixed inset-0 -z-10 bg-myth-canvas">
      <div className="myth-canvas-vignette absolute inset-0" />
    </div>
  )
}
