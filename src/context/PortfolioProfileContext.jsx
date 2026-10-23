import { createContext, useContext } from 'react'
import { profile as defaultProfile } from '../data/profile.js'

const PortfolioProfileContext = createContext(defaultProfile)

export function PortfolioProfileProvider({ value, children }) {
  return (
    <PortfolioProfileContext.Provider value={value || defaultProfile}>
      {children}
    </PortfolioProfileContext.Provider>
  )
}

export function usePortfolioProfile() {
  return useContext(PortfolioProfileContext)
}
