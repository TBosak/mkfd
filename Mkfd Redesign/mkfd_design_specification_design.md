# Mkfd Design System: Muted Iris Light

## 1. Visual Identity & Brand Personality
Mkfd is a technical "feed engineering workbench." The design language balances the utilitarian density of enterprise cloud portals (Microsoft Azure) with the refined, modernist aesthetic of high-end developer tools.

- **Personality**: Professional, precise, high-density, and stable.
- **Core Aesthetic**: High-contrast light mode with a technical color palette derived from "Muted Iris."
- **Typography**: Focused on readability and data hierarchy. Primary font: **Geist**.

## 2. Color Palette (Muted Iris)

### Base Neutrals
- **Surface**: `#f8f9fa` (Light grey for page backgrounds)
- **Surface-Dim**: `#d9dadb` (Border and divider tones)
- **Surface-Bright**: `#ffffff` (Container and card backgrounds)
- **Foreground**: `#1a1c1e` (Primary text)
- **Muted-Foreground**: `#6b7983` (Secondary/meta text)

### Functional Accents
- **Primary (Iris/Slate Blue)**: `#6b7983` / `#4a5568` (Active navigation, primary CTAs)
- **Secondary (Copper/Warm Taupe)**: `#b5835a` (Highlights, step indicators)
- **Success (Olive)**: `#849269` (Stable runs, active threads)
- **Warning (Muted Gold)**: `#c7a35d` (Retrying, warnings)
- **Error (Muted Red)**: `#b46958` (Failed runs, broken selectors)

## 3. Typography
- **Headlines**: Semi-bold, tight tracking.
- **Body**: Standard weight for labels; monospace for technical data.
- **Monospace**: Essential for the "Output Console" and raw YAML/JSON views.

## 4. Layout & Grid System
The application utilizes a **Multi-Pane Workbench** layout.

- **Sidebar**: Fixed 256px width on desktop. Contains primary modules (Feeds, Health, Settings).
- **Page Header**: 48px height. Unified breadcrumbs and primary actions.
- **Main View**:
    - **Configuration (Left/Center)**: Tabbed or stepped forms for feed setup.
    - **Live Console (Right)**: Persistent 40% width pane for real-time data inspection.
- **Density**: "Compact" is the default. Minimal padding (px-md, py-sm) to maximize information visible without scrolling.

## 5. Component Patterns

### Navigation Tabs
- Horizontal list at the top of the workbench.
- Active state: `#6b7983` bottom border (2px) and bold text.
- Inactive state: Muted foreground text.

### Status Badges
- Pill-shaped with subtle background tints and high-contrast text.
- `Running`: Olive background.
- `Error`: Muted red background.
- `Warning`: Muted gold background.

### Technical Cards
- Rounded-lg corners (8px).
- 1px border (`#d9dadb`).
- No shadows (elevation 0) to maintain the "flat" workbench feel.

## 6. Iconography
- **System**: Lucide-style line icons (1.5px stroke).
- **Standard Size**: 18px for sidebar, 16px for inline actions.
