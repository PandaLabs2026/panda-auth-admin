import { useLayoutEffect, useRef, useState } from "react"

export function useOneTimeValue(ownerId: string | null) {
  const [notice, setNotice] = useState<{ ownerId: string; value: string } | null>(null)
  const ownerVersion = useRef(0)
  const requestVersion = useRef(0)
  useLayoutEffect(() => {
    const version = ++ownerVersion.current
    setNotice((current) => current?.ownerId === ownerId ? current : null)
    return () => { ownerVersion.current = version + 1 }
  }, [ownerId])
  const watchOwner = () => {
    const version = ownerVersion.current
    return () => ownerVersion.current === version
  }
  const watchValue = () => {
    const currentOwner = watchOwner()
    const version = requestVersion.current
    return () => currentOwner() && requestVersion.current === version
  }
  return {
    value: notice?.ownerId === ownerId ? notice.value : null,
    clear: () => { requestVersion.current++; setNotice(null) },
    watchOwner,
    watchValue,
    begin: () => {
      requestVersion.current++
      setNotice(null)
      const current = watchValue()
      return {
        current,
        reveal: (value: string, targetOwner = ownerId) => {
          if (!targetOwner || !current()) return false
          setNotice({ ownerId: targetOwner, value })
          return true
        },
      }
    },
  }
}
