/**
 * The last chapter: a postcode box. A found constituency lands the film on
 * it and offers the hand-off to the explorer with that area selected, and to
 * its own page. Without the canvas the same links work as plain anchors.
 */
import { useRef, useState, type FormEvent } from 'react'
import { lookupPostcode, postcodeMessage, type PostcodeResult } from './postcode.ts'

export interface Landing {
  readonly code: string
  readonly name: string
}

export interface PostcodeLandingProps {
  readonly landed: Landing | undefined
  readonly onLand: (landing: Landing) => void
  /** Open the explorer on the landed area; undefined means follow the plain link. */
  readonly onHandOff: ((landing: Landing) => void) | undefined
}

export const explorerHref = (code: string): string => `/explore?view=map&sel=${code}`
export const areaHref = (code: string): string => `/area/constituency/${code}`

export function PostcodeLanding({ landed, onLand, onHandOff }: PostcodeLandingProps) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('postcode')
    const value = input instanceof HTMLInputElement ? input.value : ''
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setMessage('Looking up…')
    void lookupPostcode(value, undefined, controller.signal).then((result: PostcodeResult) => {
      if (controller.signal.aborted) return
      setBusy(false)
      if (result.kind === 'found') {
        setMessage(`${result.postcode} is in ${result.name}.`)
        onLand({ code: result.code, name: result.name })
      } else {
        setMessage(postcodeMessage(result))
      }
    })
  }

  return (
    <div>
      <form className="film-form" onSubmit={submit} aria-describedby="film-postcode-note">
        <label htmlFor="film-postcode" className="sr-only">
          Postcode
        </label>
        <input
          id="film-postcode"
          name="postcode"
          autoComplete="postal-code"
          placeholder="Postcode, for example SW1A 1AA"
          spellCheck={false}
          required
        />
        <button type="submit" className="film-button" disabled={busy}>
          Find my area
        </button>
      </form>
      <p id="film-postcode-note" className="film-note">
        The postcode goes to postcodes.io, an open lookup service, and is not stored.
      </p>
      <output className="film-note block" aria-live="polite">
        {message}
      </output>
      {landed === undefined ? null : (
        <div className="film-landed">
          <p className="m-0 font-display text-2xl">{landed.name}</p>
          <div className="film-chips">
            <a
              className="film-button"
              href={explorerHref(landed.code)}
              onClick={(event) => {
                if (onHandOff === undefined) return
                event.preventDefault()
                onHandOff(landed)
              }}
            >
              Carry on in the explorer
            </a>
            <a className="film-button" href={areaHref(landed.code)}>
              Its area page
            </a>
          </div>
        </div>
      )}
      <p className="film-note">
        Or <a href="/area">find an area by name</a>.
      </p>
    </div>
  )
}
