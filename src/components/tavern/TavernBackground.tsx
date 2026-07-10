// Full-bleed candlelit-tavern backdrop shared by every redesigned page.
// Background art lives at public/images/tavern-bg.jpg; the gradient
// overlays stay on top of it to keep foreground text legible regardless
// of how the image crops on a given viewport.

export function TavernBackground() {
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
