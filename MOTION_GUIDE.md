# Motion Guide

## Goal
- Snappy, low-key motion for MAJUU (Capacitor mobile-first).
- Prefer subtle opacity + tiny translate (2px to 6px).
- Never let motion make the UI feel slower.

## Timing (single source of truth)
Defined in `src/styles/motion.css`:

- `--motion-fast`: `120ms`
- `--motion-med`: `160ms`
- `--motion-slow`: `180ms` (max)
- `--motion-ease`: `cubic-bezier(0.2, 0.8, 0.2, 1)`

## Allowed Motion Patterns
- `t-fade`: opacity-only transitions
- `t-pop`: opacity + tiny `translateY(4px)` feel
- `t-slide`: opacity + tiny `translateX(6px)` feel
- `t-scale`: opacity + `scale(0.98 -> 1)`

All transition helpers default to:
- `opacity var(--motion-med) var(--motion-ease)`
- `transform var(--motion-med) var(--motion-ease)`

## Routes
- Use `src/components/PageTransitions.jsx`
- Route motion is fade + tiny `translateY(4px)` with short durations
- `AnimatePresence` in `AppLayout` is `initial={false}` and `mode="sync"` to avoid blocking/jank

## Modals / Sheets / Overlays
- Backdrop: fade only (`120ms` to `160ms`)
- Panel: fade + tiny pop (`160ms` to `180ms`)
- No spring/bouncy transitions
- Shared classes:
  - `motion-modal-backdrop`
  - `motion-modal-panel`
  - `anim-in-fade`
  - `anim-in-pop`

## Buttons / Cards / Inputs
- Buttons use subtle active press (`scale(0.98)`)
- Hover lift is minimal and only for fine pointers (`-1px`)
- Inputs/textarea/select transitions are smoothed globally (focus/placeholder/color/border/box-shadow)

## Reduced Motion
- OS-level: `prefers-reduced-motion` supported globally
- Runtime flag (optional): localStorage key `majuu_reduce_motion`
  - `1` / `true` enables reduced motion
  - `0` / `false` disables runtime override
- Helper functions in `src/utils/motionPreferences.js`

## Notes
- Tailwind `duration-300` / `duration-500` are clamped globally to MAJUU motion limits
- Heavy utility animations (`animate-pulse`, `animate-spin`) are toned down globally
- Prefer shared classes/utilities over per-component custom animation values

