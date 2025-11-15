import React from 'react'

export const Footer: React.FC = () => {
  return (
    <footer className="mt-12 border-t pt-6 flex justify-between items-center text-sm text-muted-foreground">
      <p>
        Created by{' '}
        <a
          href="https://github.com/TBosak"
          className="text-primary hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Tim Barani
        </a>
      </p>
      <a
        href="/feeds"
        className="text-primary hover:underline"
      >
        View Active Feeds
      </a>
    </footer>
  )
}
