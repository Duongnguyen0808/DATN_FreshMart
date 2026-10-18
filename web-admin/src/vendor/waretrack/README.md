# WareTrack model provenance

Source: https://github.com/NguyenThong251/waretrack-3d
Revision: 14b8edc10ecf8af190227daa5f2adac3bd9871e6

Imported on 2026-10-17 at the project owner's request:
- models/props.js: container, tree, guard booth, forklift charger factories
- models/pallet.js: loaded wooden pallet and shared geometry utilities
- palette.js and canvasText.js: materials and texture helpers

The source checkout contains no LICENSE file. This note records provenance and does not assert an open-source license or redistribution grant.

FreshMart integration lives in app/kho/mo-hinh-3d/logistics-yard.tsx. Decorative assets are outside the existing truck and forklift routes. Pallet geometry replaces only the visual mesh: selection, inventory IDs, quantities, demo state and vehicle attachments remain managed by FreshMart. No mock ERP data or simulation engine was imported.

Factories share cached geometry, materials and textures. React primitives must not dispose these shared resources. Charger LED materials are instance-owned and cleaned up separately.

## Vehicle and cargo integration

- Added models/truck.js and models/forklift.js from the same revision.
- Truck adapted with FreshMart branding, a hollow cargo bay and external articulated rear door/tail lift. The delivery truck uses the original FreshMart footprint and routes. A box truck and refrigerated truck occupy unused parking bays.
- Forklift operator is split from the cached body for motion. Hydraulic carriage follows the existing workflow height, with cargo aligned to the forks. Wheel rotation derives from world displacement, stops when stationary/paused and ignores reset jumps.
- Cardboard/blue crate/white package variants decorate pallet loads and shelf stock. Packaging is illustrative, not a new database field or a statement of actual packaging counts.
- Business workflow, confirmation rules and stock API are unchanged. Original standalone simulation is not run concurrently with the FreshMart controller.
