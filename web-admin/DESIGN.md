# FreshMart interface

## Direction
Retail operations UI: a consistent turquoise brand with semantic KPI and category colours.
Pale turquoise navigation frames a light workspace. Every module uses the same
FreshMart palette: turquoise accents, dark teal actions and white content surfaces.
Semantic stock/payment status colours retain their meaning.
Actual product photos, inventory distribution and totals carry the content.

## Sources
- https://support.sapo.vn/sapo-retail and https://support.sapo.vn/gioi-thieu-giao-dien-quan-tri-sapo-web/
  were readable as official workflow/admin guides: navigation, global search, dashboard
  summaries, product/warehouse/order workflows and operational shortcuts.
- https://help.haravan.com/docs/orders/order-management/quan-ly-don-hang/,
  https://www.haravan.com/pages/manage and https://hararetail.com/pages/omnichannel-retail
  were readable for order tabs, search/filter structure and POS workflow descriptions.
- https://dangky.nhanh.vn/phan-mem-nhanhpos was readable for barcode search and checkout
  workflow descriptions. The linked internal screenshots/images on these sites were not
  available through the browser tool, so these references are to accessible guide text;
  no claim is made that the inside screens or videos were visually reviewed.
- https://github.com/Leonxlnx/taste-skill
  commit `12af471f627f866411b4bd785b19646d3672784c`
- https://github.com/pbakaus/impeccable
  commit `7510e233b228864606888d252abacf5e7148bf87`

Both were cloned under `design-references/` (ignored local checkouts). Applied Taste
Skill's app-screen guidance and Impeccable's Operate, craft-floor and polish guidance.
Taste direction: framed-sheet, light, seed `366662547`.

## System
- Font: self-hosted IBM Plex Sans, including Vietnamese; license beside the font.
- Brand `#65CFC7`, primary action `#087F78`, soft accent `#E8F8F5`.
- Sidebar: a light turquoise gradient, rounded icon tiles and a raised white active pill.
- The desktop sidebar can collapse to a 76px icon rail; the preference stays local to the browser.
- Header: a turquoise-to-white wash and a subtle leaf motif; decorative art never blocks controls.
- Header search navigates only to permitted pages and can filter real products through the existing product API; Ctrl+K opens it.
- Dashboard banner shows the signed-in user's name, the actual last successful fetch time and live branch/report controls.
- Seven small SVG scenes share one visual grammar across the business areas. The generator is `scripts/generate-freshmart-banners.mjs`.
- Page canvas uses two low-contrast radial washes; tables and forms retain opaque content surfaces.
- Tabs: pastel rounded buttons with a measured sliding active indicator; category tabs keep their category colours.
- Cards: a restrained coloured top edge, soft elevation on hover and responsive single-column stacking.
- Text `#173B3A`, secondary `#647D7A`, border `#DFECE9`, canvas `#F4F9F8`, content white.
- Primary buttons use white text on dark teal; pale accents use dark text.
- Titles 26px, sections 18px, body/data 14px, secondary labels 12–13px.
- Spacing 8/12/16/24/32px; cards 16px radius, controls 9px; subtle panel shadows.
- KPI icons use the existing SVG Icon component. Dashboard has four real-data KPI cards;
  average order value is revenue divided by completed invoices, never invented growth.
- Related workflows use a compact link row. Lists retain filters, summaries and pagination.
- Motion: 220ms page entry, 35ms KPI stagger, 220ms submenu/modal transitions and 200ms cart feedback. Reduced-motion preference disables effects.
- Product lists offer table/gallery views with the same filters, pagination and details.
- Inventory distribution uses real summary counts; its legend filters stock status.
- Contact monograms identify records without suggesting uploaded profile photographs.
- Receipt totals, report controls and form headers use the shared turquoise palette.
- Product categories use `src/lib/category-theme.ts`: stable category code, deterministic fallback, eight distinct pastel palettes, icons and an inset selection marker. Table, gallery, details, POS and reports reuse CategoryBadge.
- KPI tones are semantic: revenue teal, profit green, orders blue, customers violet, stock value indigo, receivables cyan and payables orange. Red/amber remain available for errors and warnings.

## Implementation
`src/app/turquoise-theme.css` is the final token and component presentation layer over
existing structural styles. Maintain the palette and shared control styles there;
do not create more theme layers. Keep print layouts separate. Shared components
handle metric labels, empty states, related links and catalogue content. Business logic
is not part of this design layer.

## Verification
`node scripts/verify-retail-ui.cjs` exercises routed pages, forms, product addition,
receipt calculations, navigation and reduced motion using intercepted API fixtures.
Screenshots are written to `artifacts/retail-ui/`; these are test data, not production.
Run `npm run typecheck` for TypeScript. Taste inspector and Impeccable detector outputs
live in the ignored local tooling directories.

### Retail workflow refinement 2026-10-31
- Product list now shows removable chips for each active query, category, stock and
  selling-status filter; the reset control appears only when a filter is active.
- POS keeps its existing payment flow and adds F3 focus for the real product/barcode
  search. The key hint is hidden on narrow screens to protect input width.
- The production build and TypeScript check passed. The routed browser fixture suite
  passed at 1440, 1920, 768 and 390px; POS/cart and product-filter interaction checks
  passed separately after the final edit. There is no ESLint script/config in web-admin.

### Navigation and card refinement 2026-10-31
- Full routed browser suite passed desktop, tablet and mobile checks with intercepted API fixtures.
- Verified the active tab indicator follows its selected button, including after switching tabs.
- Reviewed product, inventory, report and payment screens at desktop and mobile sizes.
- Backend TypeScript and the Next production build passed.

### Retail banner and search refinement 2026-10-31
- Desktop/wide/tablet/mobile screenshots reviewed for dashboard, product and purchasing banners.
- Command search verified by keyboard, product query navigation and mobile search toggle.
- Sidebar open/collapsed states and all routed pages checked with intercepted API fixtures.

### Verified 2026-10-28
- TypeScript and Next production build passed.
- Routed smoke suite passed desktop/mobile and additional 768px overflow checks;
  authenticated pages also assert the local IBM Plex Sans font is available.
- Taste source lint: zero failures/warnings. Impeccable detector: no findings.
- Production login inspector at 1440/768/390: zero failures, no contrast warnings.
  One whitespace warning remains deliberately: login is a centered focused form,
  without adding irrelevant marketing content to fill desktop side margins.
- Reviewed dashboard, POS, product list, receiving form and login screenshots.
  Fixtures are sparse by design; an empty catalogue area does not justify fake products.
- These checks validate UI behavior, not live device scans or bank settlements.

### Colour refinement completed 2026-10-29
- Routed desktop/mobile suite and 768px checks passed; gallery open/detail/toggle paths added.
- Fixed tablet grid collisions and added an assertion for usable product-filter widths.
- Reviewed screenshots of POS, inventory, receiving forms, product gallery and customer list.
- TypeScript and production build passed during the refinement; subsequent fixes were scoped
  to responsive grid placement and text layout. Impeccable detector returned no findings.
- All screenshots use browser fixtures, including contact identities; no database seed ran.

### Unified palette requested 2026-10-29
Removed per-module colour overrides and alternating decorative colours on products,
contacts and overview balances. Inventory, purchasing, sales, people and reporting now
share the same green tokens, including forms and detail views. Font files and typography
are unchanged. Red/amber stock status and error indications remain semantic.

### Shared typography, 2026-10-29
Screen typography now uses one scale across modules: page titles 26px, section
headings 18px, subsection headings 16px, body/form/table/action text 14px,
captions and table headings 12px, and summary figures 28px. Keep IBM Plex Sans
and the shared green palette. Print styles remain independent.
Page heading copy stacks vertically even when there is no action group.
The 3D navigation cards wrap their text and stack on narrow phones.
The routed browser checks cover desktop, tablet and mobile with mocked API data;
an additional heading assertion guards against the single-row heading regression.

### Retail refinement, 2026-10-30
- References: https://github.com/satnaing/shadcn-admin and https://shadcn-admin.netlify.app/ for navigation/data-table organisation; https://preview.tabler.io/ and https://github.com/tabler/tabler for compact cards, product and report composition; https://motion.dev/docs/react-animation and https://motion.dev/docs/react-use-reduced-motion for motion/accessibility guidance. No external template code was copied; implementation uses the existing React, CSS and SVG components, without new runtime dependencies.
- Updated shared shell, card/control/table styling and category/KPI components. Revised catalogue, POS, product details, dashboard, forecast summaries and report category rows. Existing route-specific workflows, data and permissions remain intact.
- Removed obsolete category/metric decoration from visual-emphasis.css and conflicting report KPI styles from analytics-studio.css; the final theme and shared category configuration own these rules.
- Full routed browser suite passed at 1440x900, 1920x1080, 768x1024 and 390x844, plus login and route aliases. Verified filters, gallery/details, POS cart and checkout dialog, receipt totals, form modals, keyboard submenu toggling, menu Escape and reduced motion. API responses were intercepted: no production data was created.
- Eight category themes have distinct palettes, deterministic fallback and normal/selected text contrast of at least 4.5:1. Shared code makes category colours independent of sorting and pagination.
- Backend build passed; final web build and TypeScript passed after fixing a missing CategoryBadge import. Browser screenshots are in artifacts/retail-ui.
- No ESLint configuration/dependency exists in this repository. The available Taste source lint was run over 176 source files: 26 gradient flags, 4 checkmark-character flags and 157 advisory warnings (mostly shadows in legacy CSS). This stylistic audit is not clean: pastel gradients and restrained shadows are explicitly allowed by the current brief; checkmarks accompany status text. Impeccable could not run because its Windows binary is absent. Neither is reported as a passing code lint.
- Physical IoT scans, real payment settlement and production write operations are outside this UI verification.
