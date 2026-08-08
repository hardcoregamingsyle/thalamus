import * as React from "react"

// Matches Tailwind's `md:` breakpoint — Portal renders MobilePortal below it.
const MOBILE_BREAKPOINT = 768

/**
 * True when the viewport is narrower than the mobile breakpoint.
 *
 * The initial state is computed synchronously from matchMedia so the very
 * first render is already correct. The previous version initialised to
 * `undefined` (→ false), which mounted the full desktop tree on phones for
 * one frame — Convex subscriptions, animations and ad requests all started
 * and were immediately torn down when the effect corrected the value.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
