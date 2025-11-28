// src/app/ErrorHandlerInit.tsx
'use client'

import { useEffect } from 'react'
import { initializeErrorHandlers } from './error-handler'

/**
 * Component to initialize global error handlers
 * Must be a client component to access window and console
 */
export function ErrorHandlerInit() {
  useEffect(() => {
    initializeErrorHandlers()
  }, [])

  return null
}
