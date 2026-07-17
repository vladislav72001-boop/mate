import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './admin.css'
import { AppBootstrap } from './AppBootstrap.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppBootstrap />
  </StrictMode>,
)
