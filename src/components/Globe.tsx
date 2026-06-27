import * as React from "react"
import createGlobe from "cobe"

export default function Globe() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let phi = 0.4
    let rafId: number

    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: 800,
      height: 800,
      phi,
      theta: 0.22,
      dark: 0,
      diffuse: 0.9,
      mapSamples: 20000,
      mapBrightness: 3.5,
      mapBaseBrightness: 0.06,
      baseColor: [1, 0.92, 0.78],
      markerColor: [1, 0.55, 0.15],
      glowColor: [1, 0.82, 0.45],
      scale: 1,
      markers: [
        { location: [10.8231, 106.6297], size: 0.06 },
        { location: [21.0285, 105.8542], size: 0.05 },
        { location: [16.0544, 108.2022], size: 0.04 },
        { location: [35.6762, 139.6503], size: 0.04 },
        { location: [1.3521,  103.8198], size: 0.04 },
        { location: [37.7749, -122.419], size: 0.03 },
      ],
    })

    const animate = () => {
      phi += 0.003
      globe.update({ phi })
      rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafId)
      globe.destroy()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", aspectRatio: "1" }}
    />
  )
}
