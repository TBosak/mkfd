---
name: Muted Iris Light
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#43474b'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#74777b'
  outline-variant: '#c3c7cb'
  surface-tint: '#52606a'
  primary: '#505e67'
  on-primary: '#ffffff'
  primary-container: '#687680'
  on-primary-container: '#fcfcff'
  inverse-primary: '#bac8d4'
  secondary: '#54606b'
  on-secondary: '#ffffff'
  secondary-container: '#d7e4f1'
  on-secondary-container: '#5a6671'
  tertiary: '#6d5845'
  on-tertiary: '#ffffff'
  tertiary-container: '#87705c'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e4f0'
  primary-fixed-dim: '#bac8d4'
  on-primary-fixed: '#0f1d25'
  on-primary-fixed-variant: '#3b4952'
  secondary-fixed: '#d7e4f1'
  secondary-fixed-dim: '#bbc8d5'
  on-secondary-fixed: '#111d26'
  on-secondary-fixed-variant: '#3c4853'
  tertiary-fixed: '#fbddc5'
  tertiary-fixed-dim: '#ddc1aa'
  on-tertiary-fixed: '#27180a'
  on-tertiary-fixed-variant: '#564331'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  container-max: 1440px
  density-compact: 4px
  density-comfortable: 12px
---

## Brand & Style
The design system is engineered for high-density, technical environments where clarity and information architecture are paramount. It adopts a **Corporate / Modern** aesthetic with a lean toward **Minimalism**, emphasizing utility over decoration. 

The target audience consists of sysadmins, developers, and data analysts who require a "heads-up display" experience that minimizes eye strain while maximizing data throughput. The UI evokes a sense of calm authority, precision, and enterprise reliability. It uses a structured hierarchy to organize complex configurations, mimicking the professional rigor found in cloud infrastructure consoles.

## Colors
The palette is derived from the "Muted Iris" scheme, transposed into a light-mode environment. 
- **Primary (#6b7983):** A professional slate-blue used for active states, primary actions, and focused indicators.
- **Secondary (#4e5a65):** A deeper neutral-blue for secondary navigation and iconography.
- **Neutral/Background:** Uses high-brightness off-whites (`#f8f9fa` and `#ffffff`) to provide a clean canvas that allows technical data to stand out.
- **Functional Colors:** Error, success, and warning states should utilize desaturated versions of red, green, and amber to maintain the muted, professional tone.

## Typography
The typography system prioritizes legibility and technical precision. **Geist** is used for the primary UI and body copy due to its clean, geometric grotesque nature and excellent rendering at small sizes. 

For technical values, IDs, and code snippets, **JetBrains Mono** is introduced to provide a clear distinction between interface labels and system data. Headlines are kept compact with slight negative letter-spacing to maintain a professional, "tight" look. High information density is achieved by defaulting most interface text to the `body-md` (14px) and `body-sm` (12px) levels.

## Layout & Spacing
This design system utilizes a **Fixed Grid** philosophy for dashboard views and a **Fluid Grid** for content-heavy pages.
- **Grid:** A 12-column grid with 16px gutters. 
- **Density:** The system supports high-density layouts. Vertical spacing between related items should default to 4px or 8px.
- **Breakpoints:**
  - Desktop: 1200px+ (Full 12 columns, fixed margins).
  - Tablet: 768px - 1199px (8 columns, 16px margins).
  - Mobile: Under 767px (4 columns, 12px margins).
Reflow should prioritize vertical stacking of data widgets while maintaining the sidebar navigation as a collapsed icon rail on smaller screens.

## Elevation & Depth
Depth is communicated through **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows.
- **Base Layer:** `#ffffff` for the primary canvas.
- **Mid Layer:** `#f8f9fa` for sidebars, headers, and navigation rails.
- **Surface Layer:** `#f1f3f4` for cards and nested containers.
- **Outlines:** Elements are separated by 1px borders (`#dee2e6`). 
- **Shadows:** Use only for transient elements like dropdowns or modals. Shadows should be ultra-soft: `0 4px 12px rgba(0, 0, 0, 0.05)`.

## Shapes
The shape language is structured and professional. A `0.5rem` (8px) base radius is applied to cards, buttons, and input fields to soften the technical edge without appearing overly consumer-focused. Small components like tags or status badges use a `rounded-lg` (16px) or full pill shape to differentiate them from interactive buttons.

## Components
- **Buttons:** Primary buttons use a solid fill of `#6b7983` with white text. Secondary buttons use a transparent background with a 1px border of `#6b7983`.
- **Inputs:** Fields use a white background with a `#dee2e6` border. On focus, the border transitions to `#6b7983` with a subtle 2px outer glow.
- **Cards:** Cards are defined by a 1px border (`#dee2e6`) and no shadow. The header of the card should have a slight tonal shift to `#f8f9fa`.
- **Data Tables:** High-density rows with a 32px height. Alternate row striping using `#f8f9fa`. Row headers use `label-md` for clear categorization.
- **Status Chips:** Small, desaturated background fills (e.g., light green for 'Success') with dark text to ensure high contrast and quick scanning.
- **Navigation:** Vertical sidebar with active states indicated by a 3px left-side accent bar in `#6b7983` and a subtle background tint.