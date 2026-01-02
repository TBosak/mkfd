import { useState, useEffect } from 'react'
import { UseFormSetValue } from 'react-hook-form'
import { FeedFormData, FlareSolverrConfig } from '@/types/feed'
import { Button } from '@/components/ui/button'
import { Wand2 } from 'lucide-react'

interface SelectorPlaygroundProps {
  feedUrl?: string
  setValue: UseFormSetValue<FeedFormData>
  flaresolverr?: FlareSolverrConfig
}

export const SelectorPlayground = ({ feedUrl, setValue, flaresolverr }: SelectorPlaygroundProps) => {
  const [isPlaygroundOpen, setIsPlaygroundOpen] = useState(false)
  const [showSelectorActions, setShowSelectorActions] = useState(false)
  const [currentSelector, setCurrentSelector] = useState<string | null>(null)

  const buildProxyUrl = () => {
    const params = new URLSearchParams({ url: feedUrl || '' })
    if (flaresolverr?.enabled && flaresolverr?.serverUrl) {
      params.set('flaresolverrEnabled', 'true')
      params.set('flaresolverrUrl', flaresolverr.serverUrl)
      if (flaresolverr.timeout) {
        params.set('flaresolverrTimeout', flaresolverr.timeout.toString())
      }
    }
    return `/proxy?${params.toString()}`
  }

  useEffect(() => {
    // Listen for selector updates from the iframe
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return
      if (event.data.type === 'selectorUpdated') {
        setCurrentSelector(event.data.selector)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleOpenPlayground = () => {
    if (!feedUrl) {
      alert('Please enter a target URL first.')
      return
    }
    setIsPlaygroundOpen(true)
    setShowSelectorActions(true)
  }

  const handleClosePlayground = () => {
    setIsPlaygroundOpen(false)
    setShowSelectorActions(false)
  }

  const handleSetSelector = (fieldName: string) => {
    if (!currentSelector) {
      alert('No selector chosen yet!')
      return
    }
    setValue(fieldName as any, currentSelector)
    alert(`Set ${fieldName} to: ${currentSelector}`)
  }

  const selectorFields = [
    { field: 'itemSelector', label: 'Item' },
    { field: 'titleSelector', label: 'Title' },
    { field: 'descriptionSelector', label: 'Description' },
    { field: 'linkSelector', label: 'Link' },
    { field: 'enclosureSelector', label: 'Enclosure' },
    { field: 'authorSelector', label: 'Author' },
    { field: 'dateSelector', label: 'Date' },
    { field: 'contentEncodedSelector', label: 'Content Encoded' },
    { field: 'summarySelector', label: 'Summary' },
    { field: 'guidSelector', label: 'GUID' },
    { field: 'categoriesSelector', label: 'Item Categories' },
    { field: 'contributorsSelector', label: 'Contributors' },
    { field: 'latSelector', label: 'Latitude' },
    { field: 'longSelector', label: 'Longitude' },
    { field: 'sourceUrlSelector', label: 'Source URL' },
    { field: 'sourceTitleSelector', label: 'Source Title' },
  ]

  return (
    <>
      {/* Floating Playground Button */}
      {feedUrl && !isPlaygroundOpen && (
        <Button
          type="button"
          variant="outline"
          onClick={handleOpenPlayground}
          className="fixed top-4 right-4 z-[9999] shadow-lg"
          size="sm"
        >
          <Wand2 className="mr-2 h-4 w-4" />
          Selector Playground
        </Button>
      )}

      {/* Floating Selector Actions Sidebar */}
      {showSelectorActions && (
        <div
          className="fixed top-6 left-0 z-[10000] bg-white rounded-r-lg border-2 border-l-0 border-gray-300 shadow-lg p-2 flex flex-col gap-2 w-44 max-h-[80vh] overflow-y-auto"
          style={{ opacity: 0.98 }}
        >
          <div className="flex flex-col gap-1">
            {selectorFields.map(({ field, label }) => (
              <Button
                key={field}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSetSelector(field)}
                className="w-full text-xs whitespace-nowrap overflow-hidden text-ellipsis"
              >
                {label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              onClick={handleClosePlayground}
              className="w-full"
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Playground Overlay with Iframe */}
      {isPlaygroundOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4"
          onClick={handleClosePlayground}
        >
          <div
            className="relative w-[90%] h-[90%] bg-white rounded-lg overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={buildProxyUrl()}
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
              title="Selector Playground"
            />
          </div>
        </div>
      )}
    </>
  )
}
