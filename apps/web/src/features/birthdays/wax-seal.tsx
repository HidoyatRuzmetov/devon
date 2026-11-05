import * as React from 'react'

const sealAsset = new URL('./assets/wax-seal.webp', import.meta.url).href
const stampAsset = new URL('./assets/wax-stamp.webp', import.meta.url).href

/** Contact is anchored to the final impression, never to a generic viewport animation. */
export function WaxSeal({
  left,
  top,
  size,
  reducedMotion,
  start,
}: {
  left: number
  top: number
  size: number
  reducedMotion: boolean
  start: boolean
}) {
  const [settled, setSettled] = React.useState(reducedMotion)
  const [assets, setAssets] = React.useState({ seal: false, stamp: false })
  React.useEffect(() => {
    let active = true
    const decode = (src: string) =>
      new Promise<boolean>((resolve) => {
        const image = new Image()
        image.onload = () => {
          void image.decode().then(
            () => resolve(true),
            () => resolve(false),
          )
        }
        image.onerror = () => resolve(false)
        image.src = src
      })
    // Load during handwriting, then start contact only after both textures have decoded. A broken
    // decorative resource never blocks reading/closing the letter or leaves a missing-image icon.
    void Promise.all([decode(sealAsset), decode(stampAsset)]).then(([seal, stamp]) => {
      if (active) setAssets({ seal: seal!, stamp: stamp! })
    })
    return () => {
      active = false
    }
  }, [])
  React.useEffect(() => {
    if (reducedMotion) setSettled(true)
  }, [reducedMotion])
  const isSet = settled || reducedMotion || !assets.stamp
  if (!start || !assets.seal) return null
  return (
    <div
      className={`birthday-wax ${isSet ? 'is-set' : 'is-stamping'}`}
      aria-hidden="true"
      data-birthday-seal={isSet ? 'settled' : 'stamping'}
      style={
        { left, top, width: size, height: size, '--seal-size': `${size}px` } as React.CSSProperties
      }
    >
      {!isSet && <div className="birthday-wax-contact" />}
      <img src={sealAsset} alt="" draggable={false} className="birthday-wax-impression" />
      {!isSet && (
        <img
          src={stampAsset}
          alt=""
          draggable={false}
          className="birthday-wax-stamp"
          onAnimationEnd={() => setSettled(true)}
        />
      )}
    </div>
  )
}
