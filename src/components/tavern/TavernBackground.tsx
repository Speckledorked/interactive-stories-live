// Full-bleed backdrop shared by every redesigned page.
//
// - 'tavern' (default): the candlelit-tavern art backdrop. Background art
//   lives at public/images/tavern-bg.jpg; the gradient overlays stay on
//   top of it to keep foreground text legible regardless of how the image
//   crops on a given viewport. Always dark — every page still using it
//   hardcodes ember-toned text tuned for that.
// - 'myth': myth-canvas fill for pages migrated to the MythOS token system
//   (src/app/campaigns/[id]/{page,admin/page}.tsx) — theme-adaptive
//   instead of permanently dark, no background image. Dark mode gets a
//   soft radial vignette layered on top (subtler version of the tavern
//   variant's own technique below) so it reads as moody depth rather than
//   flat near-black; light mode stays a flat parchment fill, which needs
//   no such treatment.
export function TavernBackground({ variant = 'tavern' }: { variant?: 'tavern' | 'myth' }) {
  if (variant === 'myth') {
    return (
      <div className="fixed inset-0 -z-10 bg-myth-canvas">
        <div className="myth-canvas-vignette absolute inset-0" />
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 -z-10 bg-tavern-950 bg-cover bg-center"
      style={{ backgroundImage: "url('/images/tavern-bg.jpg')" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(220,174,71,0.08),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(139,58,58,0.10),transparent_55%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-tavern-900/40 via-tavern-950 to-black" />
    </div>
  )
}
